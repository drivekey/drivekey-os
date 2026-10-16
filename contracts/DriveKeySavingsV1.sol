// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @notice Unfunded research prototype. Classical ECDSA; independent audit required.
/// @dev No delegatecall, administrator, upgrade or arbitrary-call interface.
contract DriveKeySavingsV1 {
    enum Preset { Standard, Strong }
    enum Kind { Withdraw, Configure, Resume }
    enum Status { None, Queued, Executed, Cancelled }
    struct Action {
        Kind kind;
        address asset;
        address recipient;
        uint256 amount;
        uint256 nonce;
        uint64 expiry;
        uint64 epoch;
        bytes32 currentConfigHash;
        bytes32 newConfigHash;
    }
    struct Pending {
        uint64 queuedAt;
        uint64 readyAt;
        uint64 expiry;
        uint64 epoch;
        Status status;
        Kind kind;
    }
    struct Protection {
        uint8 kind; // 0 = cancel one action, 1 = pause and invalidate all old authorizations
        bytes32 actionId;
        uint256 nonce;
        uint64 expiry;
        uint64 epoch;
        bytes32 currentConfigHash;
    }

    address public constant USDC = 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48;
    uint256 public constant CHAIN_ID = 1;
    uint64 public constant SECURITY_DELAY = 1 hours;
    uint64 public constant MAX_LIFETIME = 24 hours;
    bytes32 public constant ACTION_TYPEHASH = keccak256("Action(uint8 kind,address asset,address recipient,uint256 amount,uint256 nonce,uint64 expiry,uint64 epoch,bytes32 currentConfigHash,bytes32 newConfigHash)");
    bytes32 public constant PROTECTION_TYPEHASH = keccak256("Protection(uint8 kind,bytes32 actionId,uint256 nonce,uint64 expiry,uint64 epoch,bytes32 currentConfigHash)");
    bytes32 private constant DOMAIN_TYPEHASH = keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    uint256 private constant HALF_ORDER = 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0;

    Preset public preset;
    uint64 public epoch = 1;
    bool public paused;
    bytes32 public currentConfigHash;
    address[] private signerList;
    mapping(address => bool) public isSigner;
    mapping(uint256 => bool) public usedNonce;
    mapping(uint256 => bool) public usedProtectionNonce;
    // Separate nonce space: a minority signer cannot consume a quorum cancellation nonce.
    mapping(uint256 => bool) public usedConfigurationCancellationNonce;
    mapping(bytes32 => Pending) public pending;
    bool private entered;

    error Invalid();
    error Unauthorized();
    error Unavailable();
    error TransferFailed();
    event Deposited(address indexed sender, uint256 amount);
    event Queued(bytes32 indexed actionId, Kind kind, uint256 nonce, uint64 epoch, uint64 readyAt, uint64 expiry);
    event Executed(bytes32 indexed actionId, Kind kind);
    event Withdrawn(bytes32 indexed actionId, address indexed asset, address indexed recipient, uint256 amount);
    event Cancelled(bytes32 indexed actionId, address indexed signer);
    event Paused(address indexed signer, uint64 epoch);
    event Resumed(uint64 epoch);
    event ConfigurationApplied(bytes32 indexed configurationHash, Preset preset, uint64 epoch);

    modifier nonReentrant() {
        if (entered) revert Unavailable();
        entered = true;
        _;
        entered = false;
    }

    constructor(Preset initialPreset, address[] memory initialSigners) {
        if (block.chainid != CHAIN_ID) revert Invalid();
        _setConfiguration(initialPreset, initialSigners);
    }

    receive() external payable { emit Deposited(msg.sender, msg.value); }

    function signers() external view returns (address[] memory) { return signerList; }
    function threshold() public view returns (uint256) { return preset == Preset.Standard ? 1 : 2; }
    function withdrawalDelay() public view returns (uint64) { return preset == Preset.Standard ? 5 minutes : 15 minutes; }
    function configurationHash(Preset value, address[] memory members) public pure returns (bytes32) {
        _validateConfiguration(value, members);
        return keccak256(abi.encode(uint8(value), members));
    }
    function domainSeparator() public view returns (bytes32) {
        return keccak256(abi.encode(DOMAIN_TYPEHASH, keccak256("DriveKey Savings"), keccak256("1"), block.chainid, address(this)));
    }
    function actionHash(Action calldata a) public view returns (bytes32) {
        return _digest(keccak256(abi.encode(ACTION_TYPEHASH, uint8(a.kind), a.asset, a.recipient, a.amount, a.nonce, a.expiry, a.epoch, a.currentConfigHash, a.newConfigHash)));
    }
    function protectionHash(Protection calldata p) public view returns (bytes32) {
        return _digest(keccak256(abi.encode(PROTECTION_TYPEHASH, p.kind, p.actionId, p.nonce, p.expiry, p.epoch, p.currentConfigHash)));
    }

    function queue(Action calldata a, bytes[] calldata approvals) external nonReentrant returns (bytes32 id) {
        _current(a.epoch, a.currentConfigHash);
        _shape(a);
        if (usedNonce[a.nonce]) revert Unavailable();
        uint64 delay = a.kind == Kind.Withdraw ? withdrawalDelay() : SECURITY_DELAY;
        if (uint256(a.expiry) <= block.timestamp + delay || uint256(a.expiry) > block.timestamp + MAX_LIFETIME) revert Invalid();
        if ((a.kind == Kind.Withdraw && paused) || (a.kind == Kind.Resume && !paused)) revert Unavailable();
        id = actionHash(a);
        _quorum(id, approvals);
        usedNonce[a.nonce] = true;
        pending[id] = Pending(uint64(block.timestamp), uint64(block.timestamp + delay), a.expiry, epoch, Status.Queued, a.kind);
        emit Queued(id, a.kind, a.nonce, epoch, uint64(block.timestamp + delay), a.expiry);
    }

    /// @dev Anybody may relay exact authorized actions; relay callers receive no funds or authority.
    function execute(Action calldata a, Preset newPreset, address[] calldata newSigners) external nonReentrant {
        _current(a.epoch, a.currentConfigHash);
        bytes32 id = actionHash(a);
        Pending storage p = pending[id];
        if (p.status != Status.Queued || p.epoch != epoch || block.timestamp < p.readyAt || block.timestamp >= p.expiry) revert Unavailable();
        if (a.kind != Kind.Configure && (newPreset != Preset.Standard || newSigners.length != 0)) revert Invalid();
        p.status = Status.Executed;
        if (a.kind == Kind.Withdraw) {
            if (paused) revert Unavailable();
            if (a.asset == address(0)) {
                (bool ok,) = a.recipient.call{value: a.amount}("");
                if (!ok) revert TransferFailed();
            } else {
                if (a.asset != USDC || USDC.code.length == 0) revert TransferFailed();
                (bool ok, bytes memory result) = USDC.call(abi.encodeWithSelector(bytes4(keccak256("transfer(address,uint256)")), a.recipient, a.amount));
                if (!ok || result.length != 32 || !abi.decode(result, (bool))) revert TransferFailed();
            }
            emit Withdrawn(id, a.asset, a.recipient, a.amount);
        } else if (a.kind == Kind.Configure) {
            if (configurationHash(newPreset, newSigners) != a.newConfigHash) revert Invalid();
            _setConfiguration(newPreset, newSigners);
            ++epoch;
            emit ConfigurationApplied(currentConfigHash, preset, epoch);
        } else {
            if (!paused) revert Unavailable();
            paused = false;
            ++epoch;
            emit Resumed(epoch);
        }
        emit Executed(id, a.kind);
    }

    function cancel(bytes32 id) external nonReentrant {
        if (!isSigner[msg.sender]) revert Unauthorized();
        _cancel(id, msg.sender, false);
    }
    function pause() external nonReentrant {
        if (!isSigner[msg.sender]) revert Unauthorized();
        _pause(msg.sender);
    }
    /// @notice Enables an offline signer to authorize a third-party gas payer to cancel or pause.
    function protect(Protection calldata p, bytes calldata approval) external nonReentrant {
        _protection(p);
        if (usedProtectionNonce[p.nonce]) revert Invalid();
        address signer = _recover(protectionHash(p), approval);
        if (!isSigner[signer]) revert Unauthorized();
        usedProtectionNonce[p.nonce] = true;
        if (p.kind == 0) _cancel(p.actionId, signer, false);
        else _pause(signer);
    }
    /// @notice Cancelling a signer/preset change requires the CURRENT quorum, including while paused.
    /// @dev A compromised minority signer cannot veto its own authorized removal.
    function cancelConfiguration(Protection calldata p, bytes[] calldata approvals) external nonReentrant {
        _protection(p);
        if (usedConfigurationCancellationNonce[p.nonce]) revert Invalid();
        Pending storage action = pending[p.actionId];
        if (p.kind != 0 || action.kind != Kind.Configure || action.epoch != epoch) revert Invalid();
        _quorum(protectionHash(p), approvals);
        usedConfigurationCancellationNonce[p.nonce] = true;
        _cancel(p.actionId, address(0), true);
    }

    function _current(uint64 expectedEpoch, bytes32 expectedHash) private view {
        if (block.chainid != CHAIN_ID || expectedEpoch != epoch || expectedHash != currentConfigHash) revert Unavailable();
    }
    function _protection(Protection calldata p) private view {
        _current(p.epoch, p.currentConfigHash);
        if (p.kind > 1 || (p.kind == 1 && p.actionId != bytes32(0)) || p.expiry <= block.timestamp || uint256(p.expiry) > block.timestamp + MAX_LIFETIME) revert Invalid();
    }
    function _shape(Action calldata a) private view {
        if (a.kind == Kind.Withdraw) {
            if ((a.asset != address(0) && a.asset != USDC) || a.recipient == address(0) || a.recipient == address(this) || a.amount == 0 || a.newConfigHash != bytes32(0)) revert Invalid();
        } else if (a.asset != address(0) || a.recipient != address(0) || a.amount != 0 || (a.kind == Kind.Configure ? a.newConfigHash == bytes32(0) : a.newConfigHash != bytes32(0))) revert Invalid();
    }
    function _quorum(bytes32 digest, bytes[] calldata approvals) private view {
        if (approvals.length != threshold()) revert Unauthorized();
        address previous;
        for (uint256 i; i < approvals.length; ++i) {
            address signer = _recover(digest, approvals[i]);
            if (!isSigner[signer] || signer <= previous) revert Unauthorized();
            previous = signer;
        }
    }
    function _recover(bytes32 digest, bytes calldata signature) private pure returns (address signer) {
        if (signature.length != 65) revert Unauthorized();
        bytes32 r; bytes32 s; uint8 v;
        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }
        if (uint256(s) == 0 || uint256(s) > HALF_ORDER || (v != 27 && v != 28)) revert Unauthorized();
        signer = ecrecover(digest, v, r, s);
        if (signer == address(0)) revert Unauthorized();
    }
    function _digest(bytes32 structure) private view returns (bytes32) { return keccak256(abi.encodePacked("\x19\x01", domainSeparator(), structure)); }
    function _validateConfiguration(Preset value, address[] memory members) private pure {
        if (members.length != (value == Preset.Standard ? 1 : 3)) revert Invalid();
        address previous;
        for (uint256 i; i < members.length; ++i) {
            if (members[i] <= previous) revert Invalid();
            previous = members[i];
        }
    }
    function _setConfiguration(Preset value, address[] memory members) private {
        bytes32 hash = configurationHash(value, members);
        for (uint256 i; i < signerList.length; ++i) isSigner[signerList[i]] = false;
        signerList = members;
        for (uint256 i; i < members.length; ++i) isSigner[members[i]] = true;
        preset = value;
        currentConfigHash = hash;
    }
    function _cancel(bytes32 id, address signer, bool configurationQuorum) private {
        if (pending[id].status != Status.Queued) revert Unavailable();
        if (pending[id].kind == Kind.Configure && !configurationQuorum) revert Unauthorized();
        pending[id].status = Status.Cancelled;
        emit Cancelled(id, signer);
    }
    function _pause(address signer) private {
        if (paused) revert Unavailable();
        paused = true;
        ++epoch;
        emit Paused(signer, epoch);
    }
}
