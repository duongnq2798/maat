// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice Subset of the B20 Asset surface (Base hardfork Cobalt) used by Maat.
/// Verified against NVDAc on Base mainnet on 2026-11-06 with `cast call`.
interface IB20Asset {
    function balanceOf(address account) external view returns (uint256);
    function decimals() external view returns (uint8);
    function approve(address spender, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function isPaused(uint8 feature) external view returns (bool);
    function policyId(bytes32 scope) external view returns (uint64);
    function uiMultiplier() external view returns (uint256);
    function effectiveAt() external view returns (uint256);
    function balanceOfUI(address account) external view returns (uint256);
}

interface IPolicyRegistry {
    function isAuthorized(uint64 policyId, address account) external view returns (bool);
    function policyExists(uint64 policyId) external view returns (bool);
}

library B20Constants {
    address internal constant POLICY_REGISTRY = 0x8453000000000000000000000000000000000002;
    uint8 internal constant FEATURE_TRANSFER = 0;
    bytes32 internal constant TRANSFER_SENDER_POLICY = keccak256("TRANSFER_SENDER_POLICY");
    bytes32 internal constant TRANSFER_RECEIVER_POLICY = keccak256("TRANSFER_RECEIVER_POLICY");
    bytes32 internal constant TRANSFER_EXECUTOR_POLICY = keccak256("TRANSFER_EXECUTOR_POLICY");
}
