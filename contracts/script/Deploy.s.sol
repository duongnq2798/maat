// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {MandateVault} from "../src/MandateVault.sol";
import {MarketCalendar} from "../src/MarketCalendar.sol";
import {AerodromeSwapAdapter} from "../src/adapters/AerodromeSwapAdapter.sol";
import {AaveV4CreditAdapter} from "../src/adapters/AaveV4CreditAdapter.sol";
import {SessionMode, TokenConfig} from "../src/Types.sol";
import {BaseAddresses as A} from "./BaseAddresses.sol";
import {MaatConfig} from "./MaatConfig.sol";

contract Deploy is Script {
    function run()
        external
        returns (
            MarketCalendar calendar,
            AerodromeSwapAdapter swapAdapter,
            AaveV4CreditAdapter creditAdapter,
            MandateVault vault
        )
    {
        address deployer = vm.envAddress("MAAT_DEPLOYER");
        address owner = vm.envAddress("MAAT_OWNER");
        address executor = vm.envAddress("MAAT_EXECUTOR");
        address payee = vm.envAddress("MAAT_EXPENSE_PAYEE");

        (address[] memory toks, TokenConfig[] memory cfgs) = MaatConfig.basket();
        (address[] memory ctoks, uint256[] memory ids) = MaatConfig.creditReserves();
        address[] memory payees = new address[](1);
        payees[0] = payee;

        // The credit adapter is bound to the vault's address, so the vault must be the 4th contract created from
        // the deployer's current nonce. Send no other transaction from the deployer until this script finishes.
        address predictedVault = vm.computeCreateAddress(deployer, vm.getNonce(deployer) + 3);

        vm.startBroadcast(deployer);
        calendar = new MarketCalendar(owner);
        swapAdapter = new AerodromeSwapAdapter();
        creditAdapter =
            new AaveV4CreditAdapter(predictedVault, A.USDC, A.AAVE_MAG7_SPOKE, A.AAVE_RESERVE_USDC, ctoks, ids);
        vault = new MandateVault(
            owner,
            executor,
            A.USDC,
            A.POLICY_REGISTRY,
            MaatConfig.defaultMandate(SessionMode.REGULAR, address(calendar), address(swapAdapter), address(creditAdapter)),
            toks,
            cfgs,
            payees
        );
        vm.stopBroadcast();
        require(address(vault) == predictedVault, "vault address mismatch");

        // Check these before broadcasting: owner is immutable on the vault and the calendar.
        console2.log("deployer            ", deployer);
        console2.log("owner (immutable)   ", owner);
        console2.log("executor            ", executor);
        console2.log("expense payee       ", payee);
        console2.log("MarketCalendar      ", address(calendar));
        console2.log("AerodromeSwapAdapter", address(swapAdapter));
        console2.log("AaveV4CreditAdapter ", address(creditAdapter));
        console2.log("MandateVault        ", address(vault));
    }
}
