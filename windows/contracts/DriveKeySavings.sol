// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Unreviewed release candidate. No deployment or funding is authorized.
/// @dev Deliberately no proxy, module, delegatecall, arbitrary execution, permit, approval, recovery or delay setters.
contract DriveKeySavings is ReentrancyGuard {
    using SafeERC20 for IERC20;
    uint256 public immutable threshold;
    uint256 public immutable withdrawalDelay;
    uint256 public constant SECURITY_DELAY = 1 hours;
    address public immutable usdc;
    uint256 public epoch = 1;
    uint256 public sequence;
    address[] private owners;
    mapping(address => bool) public isSigner;
    struct Proposal {
        uint256 epoch;
        uint256 approvals;
        uint256 readyAt;
        bool securityChange;
        bool closed;
        address asset;
        address recipient;
        uint256 amount;
        address[] newSigners;
    }
    mapping(bytes32 => Proposal) private proposals;
    mapping(bytes32 => mapping(address => bool)) public approved;
    event Proposed(bytes32 indexed id, uint256 indexed epoch, bool securityChange, address asset, address recipient, uint256 amount);
    event Approval(bytes32 indexed id, address indexed signer, uint256 readyAt);
    event Executed(bytes32 indexed id);
    event Cancelled(bytes32 indexed id);
    event SignersChanged(uint256 indexed epoch, address[] signers);
    modifier onlySigner() { require(isSigner[msg.sender], "signer required"); _; }
    constructor(address[] memory signers_, bool strong, address usdc_) {
        require(block.chainid == 1 || block.chainid == 11155111, "Ethereum only");
        require(usdc_ != address(0) && usdc_.code.length > 0, "token contract required");
        threshold = strong ? 2 : 1;
        withdrawalDelay = strong ? 15 minutes : 5 minutes;
        usdc = usdc_;
        _replace(signers_, strong ? 3 : 1);
    }
    receive() external payable {}
    function signers() external view returns (address[] memory) { return owners; }
    function details(bytes32 id) external view returns (uint256 proposalEpoch, uint256 approvals, uint256 readyAt, bool securityChange, bool closed) {
        Proposal storage p = proposals[id]; return (p.epoch, p.approvals, p.readyAt, p.securityChange, p.closed);
    }
    function proposeWithdrawal(address asset, address recipient, uint256 amount) external onlySigner returns (bytes32 id) {
        require(asset == address(0) || asset == usdc, "unsupported asset");
        require(recipient != address(0) && recipient != address(this) && amount > 0, "invalid withdrawal");
        id = keccak256(abi.encode(address(this), block.chainid, epoch, sequence++, asset, recipient, amount));
        Proposal storage p = proposals[id]; p.epoch = epoch; p.asset = asset; p.recipient = recipient; p.amount = amount;
        emit Proposed(id, epoch, false, asset, recipient, amount); _approve(id, p);
    }
    function proposeSigners(address[] calldata next) external onlySigner returns (bytes32 id) {
        _validate(next, owners.length);
        id = keccak256(abi.encode(address(this), block.chainid, epoch, sequence++, next));
        Proposal storage p = proposals[id]; p.epoch = epoch; p.securityChange = true; p.newSigners = next;
        emit Proposed(id, epoch, true, address(0), address(0), 0); _approve(id, p);
    }
    function approve(bytes32 id) external onlySigner {
        Proposal storage p = proposals[id]; require(p.epoch == epoch && !p.closed, "stale or closed"); _approve(id, p);
    }
    function cancel(bytes32 id) external onlySigner {
        Proposal storage p = proposals[id]; require(p.epoch == epoch && !p.closed, "stale or closed"); p.closed = true; emit Cancelled(id);
    }
    function execute(bytes32 id) external nonReentrant {
        Proposal storage p = proposals[id];
        require(p.epoch == epoch && !p.closed && p.approvals >= threshold && p.readyAt != 0 && block.timestamp >= p.readyAt, "not ready");
        p.closed = true;
        if (p.securityChange) {
            _replace(p.newSigners, owners.length); epoch++; emit SignersChanged(epoch, owners);
        } else if (p.asset == address(0)) {
            (bool ok,) = payable(p.recipient).call{value:p.amount}(""); require(ok, "native transfer failed");
        } else { IERC20(usdc).safeTransfer(p.recipient, p.amount); }
        emit Executed(id);
    }
    function _approve(bytes32 id, Proposal storage p) private {
        require(!approved[id][msg.sender], "duplicate signer"); approved[id][msg.sender] = true; p.approvals++;
        // The full delay starts when the required final signer approves.
        if (p.approvals == threshold) p.readyAt = block.timestamp + (p.securityChange ? SECURITY_DELAY : withdrawalDelay);
        emit Approval(id, msg.sender, p.readyAt);
    }
    function _validate(address[] memory next, uint256 count) private view {
        require(next.length == count, "fixed signer count");
        for (uint256 i; i < count; i++) {
            require(next[i] != address(0) && next[i] != address(this) && next[i].code.length == 0, "EOA signer required");
            for (uint256 j; j < i; j++) require(next[j] != next[i], "independent addresses required");
        }
    }
    function _replace(address[] memory next, uint256 count) private {
        _validate(next, count);
        for (uint256 i; i < owners.length; i++) isSigner[owners[i]] = false;
        delete owners;
        for (uint256 i; i < next.length; i++) { owners.push(next[i]); isSigner[next[i]] = true; }
    }
}
