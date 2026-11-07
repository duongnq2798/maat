// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Action, Reason, Mandate, TokenConfig} from "./Types.sol";

interface IMandateVaultEvents {
    event Decision(
        bytes32 indexed intentId,
        Action action,
        address indexed token,
        uint256 amount,
        bool allowed,
        Reason reason,
        bytes32 rationaleHash
    );
    event ExecutorSet(address indexed executor);
    event PausedSet(bool paused);
    /// @dev Queue events carry the full preimage so anyone can see exactly what will change, and when.
    event MandateChangeQueued(bytes32 indexed changeHash, uint256 eta, Mandate mandate);
    event TokenConfigChangeQueued(bytes32 indexed changeHash, uint256 eta, address indexed token, TokenConfig config);
    event PayeeChangeQueued(bytes32 indexed changeHash, uint256 eta, address indexed payee, bool allowed);
    event ChangeCancelled(bytes32 indexed changeHash);
    event PolicyHashUpdated(bytes32 policyHash);
    event Funded(uint256 amount);
    event MandateApplied(bytes32 indexed mandateHash);
    event TokenConfigApplied(address indexed token, TokenConfig config);
    event PayeeApplied(address indexed payee, bool allowed);
    event RevenueReceived(uint256 amount);
    event Withdrawn(address indexed token, uint256 amount);
    event MultiplierChangeDetected(address indexed token, uint256 oldMultiplier, uint256 newMultiplier);
}
