// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

// Derived from RuleWallet's separated roles, policy registry and conservative
// 25-hour-bucket accounting model. Copyright (c) 2026 RuleWallet contributors.
// V4 is a separate, non-upgradeable protocol; no V3 storage or signatures apply.
library RulesV4 {
    struct Limit { uint128 perPayment; uint128 rolling; uint128 sevenDay; uint128 thirtyDay; uint128 approvalAbove; uint32 count; }
    struct Recipient { address recipient; uint8 category; Limit eth; Limit usdg; }
    struct Bundle { address agent; address approver; address guardian; uint64 expires; uint8 weekdays; uint16 startMinute; uint16 endMinute; uint16 categories; bool paused; Limit eth; Limit usdg; Recipient[] recipients; }
}

contract DriveKeyRegistryV4 {
    address public immutable account;
    bytes private encoded;
    struct Bucket { uint256 amount; uint256 count; }
    // Stable keys never include policy revision or allowlist position.
    mapping(bytes32 => mapping(uint256 => Bucket)) private hourly;
    mapping(bytes32 => mapping(uint256 => Bucket)) private sevenDay;
    mapping(bytes32 => mapping(uint256 => Bucket)) private thirtyDay;
    constructor() { account = msg.sender; }
    modifier onlyAccount() { require(msg.sender == account, "account only"); _; }
    function policy() external view returns (bytes memory) { return encoded; }
    function replace(bytes calldata value) external onlyAccount { encoded = value; }
    function usage(bytes32 key) public view returns (uint256 rollingAmount, uint256 rollingCount, uint256 sevenAmount, uint256 thirtyAmount) {
        uint256 hour = block.timestamp / 1 hours;
        for (uint256 i; i < 25 && i <= hour; i++) { Bucket storage b = hourly[key][hour-i]; rollingAmount += b.amount; rollingCount += b.count; }
        sevenAmount = sevenDay[key][block.timestamp / 7 days].amount;
        thirtyAmount = thirtyDay[key][block.timestamp / 30 days].amount;
    }
    function check(bytes32 key, RulesV4.Limit memory l, uint256 amount) public view {
        (uint256 r, uint256 n, uint256 w, uint256 m) = usage(key);
        require(amount > 0 && amount <= l.perPayment && r + amount <= l.rolling && w + amount <= l.sevenDay && m + amount <= l.thirtyDay && n + 1 <= l.count, "hard cap");
    }
    function consume(bytes32 key, RulesV4.Limit calldata l, uint256 amount) external onlyAccount {
        check(key,l,amount);
        Bucket storage h = hourly[key][block.timestamp / 1 hours]; h.amount += amount; h.count++;
        sevenDay[key][block.timestamp / 7 days].amount += amount;
        thirtyDay[key][block.timestamp / 30 days].amount += amount;
    }
}

contract DriveKeyAccountV4 {
    address public immutable owner;
    address public immutable stablecoin;
    DriveKeyRegistryV4 public immutable registry;
    uint256 public constant CONTRACT_VERSION = 4;
    uint256 public constant ownerEpoch = 1;
    uint256 public revision;
    uint256 public safetyEpoch;
    bytes32 public policyHash;
    bool public paused = true;
    bool private entered;
    RulesV4.Bundle private rules;
    bytes32 private constant POLICY_TYPE = keccak256("PolicyAuthorization(address registry,uint256 contractVersion,uint256 ownerEpoch,uint256 safetyEpoch,uint256 expectedRevision,bytes32 expectedHash,bytes32 newRulesHash,uint256 authorizationExpiry)");
    bytes32 private constant APPROVAL_TYPE = keccak256("PaymentApproval(bytes32 paymentId,address asset,address recipient,uint256 amount,uint8 category,uint256 revision,uint256 safetyEpoch,uint256 expiry)");
    struct Pending { address asset; address recipient; uint256 amount; uint8 category; uint256 revision; uint256 epoch; uint256 expiry; bool exists; }
    mapping(bytes32 => Pending) public pending;
    mapping(bytes32 => bool) public usedIds;
    event PolicyApplied(uint256 indexed revision, bytes32 indexed policyHash, uint256 safetyEpoch);
    event Stopped(uint256 safetyEpoch);
    event ApprovalRequested(bytes32 indexed paymentId, address asset, address recipient, uint256 amount, uint8 category, uint256 revision, uint256 safetyEpoch, uint256 expiry);
    event PaymentExecuted(bytes32 indexed paymentId, address indexed asset, address indexed recipient, uint256 amount, uint8 category, uint256 revision);
    constructor(address o, address a, address ap, address g, address token) {
        require(block.chainid == 4663 && token == 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168, "chain/asset");
        distinct(o,a,ap,g); owner=o; stablecoin=token; registry=new DriveKeyRegistryV4();
        rules.agent=a; rules.approver=ap; rules.guardian=g;
    }
    receive() external payable {}
    function agent() external view returns(address) { return rules.agent; }
    function approver() external view returns(address) { return rules.approver; }
    function guardian() external view returns(address) { return rules.guardian; }
    modifier lock() { require(!entered,"reentry"); entered=true; _; entered=false; }
    function distinct(address o,address a,address ap,address g) private pure {
        require(o!=address(0)&&a!=address(0)&&ap!=address(0)&&g!=address(0)&&o!=a&&o!=ap&&o!=g&&a!=ap&&a!=g&&ap!=g,"role collision");
    }
    function domainSeparator() public view returns(bytes32) {
        return keccak256(abi.encode(keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),keccak256("DriveKey Rules"),keccak256("4"),block.chainid,address(this)));
    }
    function digest(bytes32 h) private view returns(bytes32) { return keccak256(abi.encodePacked(hex"1901",domainSeparator(),h)); }
    function signer(bytes32 h, bytes calldata sig) private pure returns(address result) {
        require(sig.length==65,"signature length"); bytes32 r; bytes32 s; uint8 v;
        assembly { r := calldataload(sig.offset) s := calldataload(add(sig.offset,32)) v := byte(0,calldataload(add(sig.offset,64))) }
        require(uint256(s)<=0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0 && (v==27||v==28),"signature canonical");
        result=ecrecover(h,v,r,s); require(result!=address(0),"signature invalid");
    }
    function applyPolicy(bytes calldata bundle,uint256 expectedRevision,bytes32 expectedHash,uint256 epoch,uint256 expiry,bytes calldata signature) external lock {
        require(block.timestamp<expiry && epoch==safetyEpoch && expectedRevision==revision && expectedHash==policyHash,"stale authorization");
        bytes32 nextHash=keccak256(bundle);
        require(signer(digest(keccak256(abi.encode(POLICY_TYPE,address(registry),CONTRACT_VERSION,ownerEpoch,epoch,expectedRevision,expectedHash,nextHash,expiry))),signature)==owner,"owner signature");
        RulesV4.Bundle memory b=abi.decode(bundle,(RulesV4.Bundle));
        require(keccak256(abi.encode(b))==nextHash,"noncanonical bundle");
        distinct(owner,b.agent,b.approver,b.guardian);
        require(b.expires>block.timestamp && b.weekdays>0 && b.weekdays<=127 && b.startMinute<b.endMinute && b.endMinute<=1440 && b.categories<=511 && b.recipients.length<=16,"policy invalid");
        for(uint256 i;i<b.recipients.length;i++) {
            require(b.recipients[i].recipient!=address(0) && b.recipients[i].recipient!=address(this) && b.recipients[i].category<=8,"recipient invalid");
            for(uint256 j;j<i;j++) require(b.recipients[i].recipient!=b.recipients[j].recipient,"duplicate recipient");
        }
        // A policy that stops spending is itself a safety transition.
        if(b.paused) safetyEpoch++;
        rules=b; paused=b.paused; policyHash=nextHash; revision++;
        registry.replace(bundle); emit PolicyApplied(revision,nextHash,safetyEpoch);
    }
    function stop() external lock { require(msg.sender==owner || msg.sender==rules.guardian,"pause authority"); paused=true; safetyEpoch++; emit Stopped(safetyEpoch); }
    function limits(address asset,address recipient,uint8 category,uint256 amount) private view returns(RulesV4.Limit memory global, RulesV4.Limit memory local) {
        require(!paused && block.timestamp<rules.expires,"paused/expired");
        uint256 minute=(block.timestamp % 1 days)/1 minutes;
        uint256 weekday=(block.timestamp/1 days+3)%7; // Monday bit zero; epoch was Thursday.
        require((uint256(rules.weekdays)&(1<<weekday))!=0 && minute>=rules.startMinute && minute<rules.endMinute,"schedule");
        require(category<=8 && (uint256(rules.categories)&(1<<category))!=0,"category");
        require(asset==address(0)||asset==stablecoin,"asset");
        global=asset==address(0)?rules.eth:rules.usdg;
        bool found;
        for(uint256 i;i<rules.recipients.length;i++) if(rules.recipients[i].recipient==recipient && rules.recipients[i].category==category) { found=true; local=asset==address(0)?rules.recipients[i].eth:rules.recipients[i].usdg; break; }
        require(found,"recipient");
        registry.check(keccak256(abi.encode(asset,address(0))),global,amount);
        registry.check(keccak256(abi.encode(asset,recipient)),local,amount);
    }
    function requestPayment(bytes32 id,address asset,address recipient,uint256 amount,uint8 category,uint256 expiry) external lock {
        require(msg.sender==rules.agent && !usedIds[id] && id!=bytes32(0) && expiry>block.timestamp && expiry<=rules.expires,"request");
        (RulesV4.Limit memory g,RulesV4.Limit memory l)=limits(asset,recipient,category,amount);
        usedIds[id]=true;
        if(amount>g.approvalAbove || amount>l.approvalAbove) {
            pending[id]=Pending(asset,recipient,amount,category,revision,safetyEpoch,expiry,true);
            emit ApprovalRequested(id,asset,recipient,amount,category,revision,safetyEpoch,expiry);
        } else pay(id,asset,recipient,amount,category,g,l);
    }
    function executeApproved(bytes32 id,bytes calldata signature) external lock {
        require(msg.sender==rules.agent,"agent only"); Pending memory p=pending[id];
        require(p.exists && p.revision==revision && p.epoch==safetyEpoch && block.timestamp<p.expiry,"stale approval");
        require(signer(digest(keccak256(abi.encode(APPROVAL_TYPE,id,p.asset,p.recipient,p.amount,p.category,p.revision,p.epoch,p.expiry))),signature)==rules.approver,"approver signature");
        (RulesV4.Limit memory g,RulesV4.Limit memory l)=limits(p.asset,p.recipient,p.category,p.amount);
        delete pending[id]; pay(id,p.asset,p.recipient,p.amount,p.category,g,l);
    }
    function pay(bytes32 id,address asset,address recipient,uint256 amount,uint8 category,RulesV4.Limit memory g,RulesV4.Limit memory l) private {
        registry.consume(keccak256(abi.encode(asset,address(0))),g,amount); registry.consume(keccak256(abi.encode(asset,recipient)),l,amount);
        if(asset==address(0)) { (bool ok,)=recipient.call{value:amount}(""); require(ok,"ETH transfer"); }
        else { (bool ok,bytes memory result)=asset.call(abi.encodeWithSignature("transfer(address,uint256)",recipient,amount)); require(ok && (result.length==0 || abi.decode(result,(bool))),"token transfer"); }
        emit PaymentExecuted(id,asset,recipient,amount,category,revision);
    }
}
