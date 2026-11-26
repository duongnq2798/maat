// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Deploy} from "../../script/Deploy.s.sol";
import {MandateVault} from "../../src/MandateVault.sol";
import {MarketCalendar} from "../../src/MarketCalendar.sol";
import {AerodromeSwapAdapter} from "../../src/adapters/AerodromeSwapAdapter.sol";
import {AaveV4CreditAdapter} from "../../src/adapters/AaveV4CreditAdapter.sol";
import {SessionMode, Mandate, TokenConfig} from "../../src/Types.sol";
import {BaseAddresses as A} from "../../script/BaseAddresses.sol";
import {MaatConfig} from "../../script/MaatConfig.sol";

contract DeployForkTest is Test {
    function test_deployWiresEverything() public {
        vm.createSelectFork("base", A.BLOCK_SESSION);
        address owner = makeAddr("owner");
        address executor = makeAddr("executor");
        address payee = makeAddr("payee");
        vm.setEnv("MAAT_OWNER", vm.toString(owner));
        vm.setEnv("MAAT_EXECUTOR", vm.toString(executor));
        vm.setEnv("MAAT_EXPENSE_PAYEE", vm.toString(payee));
        // pinned to unset: forge loads contracts/.env, where an operator may have put a real second payee
        vm.setEnv("MAAT_EXPENSE_PAYEE_2", vm.toString(address(0)));
        address deployer = makeAddr("deployer");
        vm.setEnv("MAAT_DEPLOYER", vm.toString(deployer));
        // a used deployer: the vault-address prediction must start from its real nonce, not zero
        uint64 n = vm.getNonce(deployer) + 7;
        vm.setNonce(deployer, n);

        (MarketCalendar calendar, AerodromeSwapAdapter adapter, AaveV4CreditAdapter credit, MandateVault vault) =
            new Deploy().run();

        assertEq(vault.owner(), owner);
        assertEq(vault.executor(), executor);
        assertEq(vault.usdc(), A.USDC);
        assertEq(vault.policyRegistry(), A.POLICY_REGISTRY);
        assertTrue(vault.allowedPayee(payee));
        assertEq(vault.tokens().length, 3);
        assertEq(vault.mandate().calendar, address(calendar));
        assertEq(vault.mandate().swapAdapter, address(adapter));
        assertEq(uint8(vault.mandate().sessionMode), uint8(SessionMode.REGULAR));
        assertEq(calendar.owner(), owner);
        assertEq(vault.mandate().creditAdapter, address(credit));
        assertEq(credit.vault(), address(vault));
        assertEq(address(vault), vm.computeCreateAddress(deployer, n + 3));
        assertEq(credit.usdc(), A.USDC);
        assertEq(credit.hub(), A.AAVE_EQUITIES_HUB);
        assertEq(address(credit.spoke()), A.AAVE_MAG7_SPOKE);
        assertEq(credit.collaterals().length, 3);

        // the deployed policy is exactly MaatConfig's
        Mandate memory m =
            MaatConfig.defaultMandate(SessionMode.REGULAR, address(calendar), address(adapter), address(credit));
        assertEq(vault.mandateHash(), keccak256(abi.encode(m)));

        (address[] memory toks, TokenConfig[] memory cfgs) = MaatConfig.basket();
        address[] memory listed = vault.tokens();
        for (uint256 i; i < toks.length; ++i) {
            assertEq(listed[i], toks[i]);
            (bool allowed, address feed, address pool, uint16 w) = vault.tokenConfig(toks[i]);
            assertEq(allowed, cfgs[i].allowed);
            assertEq(feed, cfgs[i].feed);
            assertEq(pool, cfgs[i].pool);
            assertEq(w, cfgs[i].maxWeightBps);
        }

        address[] memory payees = new address[](1);
        payees[0] = payee;
        assertEq(vault.payees(), payees);
        bytes32 ph = vault.policyHash();
        assertTrue(ph != bytes32(0));
        assertEq(ph, keccak256(abi.encode(m, toks, cfgs, payees)));
    }
}
