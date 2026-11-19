// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";

// Fails on purpose, to prove that a failing forge test turns the contracts job and the summary gate red.
// It lives only on the throwaway branch chore/ci-red-proof, which is never merged
// (docs/superpowers/specs/2026-11-18-maat-ci-design.md, section 8 step 5).
contract RedProofTest is Test {
    function test_failsOnPurpose() public pure {
        assertTrue(false, "red proof: fails on purpose");
    }
}
