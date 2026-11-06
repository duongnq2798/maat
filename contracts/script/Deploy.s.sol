// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {MandateVault} from "../src/MandateVault.sol";
import {MarketCalendar} from "../src/MarketCalendar.sol";
import {AerodromeSwapAdapter} from "../src/adapters/AerodromeSwapAdapter.sol";
import {SessionMode, TokenConfig} from "../src/Types.sol";
import {BaseAddresses as A} from "./BaseAddresses.sol";
import {MaatConfig} from "./MaatConfig.sol";

contract Deploy is Script {
    function run() external returns (MarketCalendar calendar, AerodromeSwapAdapter adapter, MandateVault vault) {
        address owner = vm.envAddress("MAAT_OWNER");
        address executor = vm.envAddress("MAAT_EXECUTOR");
        address payee = vm.envAddress("MAAT_EXPENSE_PAYEE");

        (address[] memory toks, TokenConfig[] memory cfgs) = MaatConfig.basket();
        address[] memory payees = new address[](1);
        payees[0] = payee;

        vm.startBroadcast();
        calendar = new MarketCalendar(owner);
        adapter = new AerodromeSwapAdapter();
        vault = new MandateVault(
            owner,
            executor,
            A.USDC,
            A.POLICY_REGISTRY,
            MaatConfig.defaultMandate(SessionMode.REGULAR, address(calendar), address(adapter)),
            toks,
            cfgs,
            payees
        );
        vm.stopBroadcast();

        console2.log("MarketCalendar      ", address(calendar));
        console2.log("AerodromeSwapAdapter", address(adapter));
        console2.log("MandateVault        ", address(vault));
    }
}
