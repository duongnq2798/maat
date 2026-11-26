// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {MaatInbox} from "../src/MaatInbox.sol";

/// @notice Deploys MaatInbox. It takes no constructor arguments and has no owner, so the deployer keeps no power over it.
/// The owner broadcasts it with `--broadcast --verify`; without `--broadcast` it is only a simulation.
contract DeployMaatInbox is Script {
    function run() external returns (MaatInbox) {
        return deploy(vm.envAddress("MAAT_DEPLOYER"));
    }

    /// @notice Deploys from `deployer`, which must be the `--account` wallet when broadcasting.
    function deploy(address deployer) public returns (MaatInbox inbox) {
        address predicted = vm.computeCreateAddress(deployer, vm.getNonce(deployer));

        vm.startBroadcast(deployer);
        inbox = new MaatInbox();
        vm.stopBroadcast();
        require(address(inbox) == predicted, "inbox address mismatch");

        // Check the deployer line before broadcasting: it must match the --account wallet character for character.
        console2.log("deployer ", deployer);
        console2.log("MaatInbox", address(inbox));
    }
}
