// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {VaultFixture} from "./utils/VaultFixture.sol";
import {Deploy} from "../script/Deploy.s.sol";
import {MandateVault} from "../src/MandateVault.sol";
import {TokenConfig} from "../src/Types.sol";

contract DeployHarness is Deploy {
    function expensePayeesOf(address first, address second) external pure returns (address[] memory) {
        return expensePayees(first, second);
    }
}

contract DeployTest is VaultFixture {
    DeployHarness internal h = new DeployHarness();
    address internal payee2 = makeAddr("payee2");

    function test_expensePayees_onePayee() public view {
        address[] memory want = new address[](1);
        want[0] = payee;
        assertEq(h.expensePayeesOf(payee, address(0)), want);
    }

    function test_expensePayees_twoPayees() public {
        address[] memory list = h.expensePayeesOf(payee, payee2);
        address[] memory want = new address[](2);
        want[0] = payee;
        want[1] = payee2;
        assertEq(list, want);

        // both are on the allowlist from construction, in this order, with no timelocked change
        address[] memory toks = new address[](1);
        toks[0] = address(nvda);
        TokenConfig[] memory cfgs = new TokenConfig[](1);
        cfgs[0] = TokenConfig({allowed: true, feed: address(feed), pool: address(pool), maxWeightBps: 4000});
        MandateVault v = new MandateVault(
            owner, executor, address(usdc), address(registry), defaultMandate(), toks, cfgs, list
        );
        assertEq(v.payees(), want);
        assertTrue(v.allowedPayee(payee));
        assertTrue(v.allowedPayee(payee2));
    }

    function test_expensePayees_secondEqualToFirstReverts() public {
        vm.expectRevert(bytes("MAAT_EXPENSE_PAYEE_2 equals MAAT_EXPENSE_PAYEE"));
        h.expensePayeesOf(payee, payee);
    }

    function test_expensePayees_secondUnsetGivesOnePayee() public {
        // The read run() makes; no test sets this variable, so skip only if the shell exports one.
        vm.skip(vm.envExists("MAAT_EXPENSE_PAYEE_2"));
        address[] memory list = h.expensePayeesOf(payee, vm.envOr("MAAT_EXPENSE_PAYEE_2", address(0)));
        assertEq(list.length, 1);
        assertEq(list[0], payee);
    }
}
