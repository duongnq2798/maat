# Maat — Plan 2A: Credit (Aave V4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add four credit actions (SUPPLY, WITHDRAW_COLLATERAL, BORROW, REPAY) to `MandateVault` through an `ICreditAdapter`. The first implementation is `AaveV4CreditAdapter` on the Aave V4 Equities Hub (MAG7 Spoke) on Base. The vault must keep the spec's rules: borrowing is allowed only when the market is open and HF is high enough, with stricter limits inside the "Friday derisk window". Includes unit tests, fork tests on Base and the v1 deploy script.

**Architecture:** The vault remains the decision-maker. The adapter only executes, and only the vault can call it. The adapter is the Aave "user": it holds the collateral and the debt, and every asset it withdraws goes back to the vault. The vault checks first (`_checkCredit`, a view shared with `previewIntent`). The adapter checks HF again after a borrow or withdraw and reverts `HealthFactorTooLow` if HF is below the level the vault requires. The vault catches every adapter revert and turns it into a `Decision` with the matching reason, so `execute()` never reverts because of the adapter. Each vault has its own adapter. The vault address is precomputed (`computeCreateAddress`) so the adapter points back to the right vault.

**Tech Stack:** Solidity 0.8.28, Foundry ≥ 1.8.4 (`hardfork = "base:Cobalt"`), forge-std. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-06-mandate-treasury-design.md` (§3.1 checks table and "Checks applied by action type", §3.2 mandate `targetHF` / `minHF` / `fridayDeriskWindow`, §3.3 `ICreditAdapter`).

### Plan 2 is split in two
- **Plan 2A (this file):** the Solidity part for credit. No further research needed: the Aave V4 spike from a contract already works (research/04 §5).
- **Plan 2B (written later):** the TypeScript agent runtime (Claude API, CDP Server Wallet as executor, Builder Code `dataSuffix`). Plan 2B uses the ABI of 2A and needs a round of CDP / Builder Codes research before it is written. Items carried over to 2B:
  - The Guard Service and the agent must `eth_call` `previewIntent` with `from = executor`, because GuardLib checks the B20 executor policy against `tx.origin`.
  - The Plan 1 doc still says `queueChange`; the real code uses `queueMandate` / `queueTokenConfig` / `queuePayee` + a 7-day grace period. Fix the doc before 2B generates the ABI client.

### Verified facts (research/03, research/04 §5, fork at `BLOCK_SESSION = 53_551_627`)
- MAG7 Spoke `0x17905Db0e4A3514467539956c084180616AE7B8D`, Equities Hub `0xa4d5947Eb727A052bae69C593FfC84247EC9864E`, oracle `0xaBaf048fD7675Ea34a84332371ffd5D55E322A47` (`decimals() = 8`, `getReservePrice(7) = 99_984_724`).
- Reserve IDs on this spoke: AAPLc `0`, GOOGLc `2`, NVDAc `5`, USDC `7`. Collateral factor (also the liquidation threshold): NVDAc 70%, GOOGLc 76%, AAPLc 78%.
- The contract can be borrowed from (no allowlist). `supply` does **not** enable collateral by itself: you must call `setUsingAsCollateral(id, true, user)`.
- The spoke pulls tokens with `transferFrom(msg.sender → hub)` on supply, so the executor of that leg is the spoke. The hub holds all the collateral and transfers tokens out itself on withdraw.
- `getUserAccountData`: `totalCollateralValue` has unit 1e26 = $1, `avgCollateralFactor` is WAD, `totalDebtValueRay` = value × 1e27, `healthFactor` is WAD (= `type(uint256).max` when there is no debt).
- The projection formula `HF = coll × avgCF / (debtRay / 1e27 + amount × usdcPrice8 × 1e12)` matches the real HF after borrowing $5 against $19.98 of NVDAc (HF 2.7979e18).
- `repay` with an amount larger than the debt does not revert; it pulls exactly the debt. `withdraw(id, type(uint256).max, user)` withdraws everything. No minimum borrow limit was seen at the $5 level.

## Global Constraints

- Solidity `0.8.28`; Foundry **≥ 1.8.4**; `foundry.toml` has `hardfork = "base:Cobalt"` and `via_ir = true`. No new dependencies.
- Units: USDC has 6 decimals; B20 has 8 decimals; the Chainlink equity feed has 8 decimals and is the **price of 1 raw token**. Aave V4: value 1e26 = $1, debt = value × 1e27, HF is WAD (1e18 = 1.00).
- `execute()` **does not revert** when the guard or the adapter rejects. The vault reverts only on wrong permissions (`NotExecutor`) or replay (`IntentAlreadyUsed`). Every other outcome, including an adapter revert, emits `Decision`.
- Funds leave the vault by three paths: a swap through the swap adapter in the mandate (the funds come back to the vault), `PAY_EXPENSE` to a payee on the allowlist, and the credit adapter in the mandate. The adapter accepts orders only from its own vault, and every asset withdrawn or borrowed goes straight to the vault. When the owner withdraws funds, they go only to `owner`.
- The `Action` and `Reason` enums are **append-only**, never reordered. New reasons: `CREDIT_FAILED = 17`, `HEALTH_FACTOR_LOW = 18`, `DERISK_WINDOW = 19`.
- Loosening the configuration goes through `queueMandate` / `queueTokenConfig` / `queuePayee`, with a **24h** timelock, applied within a **7-day** grace period (Plan 1). Do not use the name `queueChange`.
- Spec §3.1: SUPPLY and REPAY (risk-reducing) are subject only to checks 1–3 (allowlist, pause, policy) and are **never** blocked because the market is closed. BORROW, and WITHDRAW_COLLATERAL while debt remains (risk-increasing), are subject to checks 1–6 for every collateral currently supplied. Credit does not count toward `perTradeCapUsd` / `dailyCapUsd` (the spec applies checks 1–6 only to supply/borrow); HF is the limit.
- Default credit parameters (spec §3.2): `minHealthFactor 1.5e18`, `targetHealthFactor 2.0e18`, `deriskWindow 4 hours`. `MaatConfig` keeps `maxPremiumBps 100`; `VaultFixture` keeps `maxPremiumBps 50`.
- GuardLib checks the B20 executor policy against `tx.origin` (carry-over from Plan 1). Tests call `execute` with `vm.prank(executor, executor)`.
- `MandateVault` runtime ≤ **24,576 B** (EIP-170, enforced on Base). Currently 16,996 B. Tasks 3, 4 and 5 end with `forge build --sizes`. If it is exceeded: set `optimizer_runs = 50` in `foundry.toml` and rerun all the tests; if it is still exceeded, stop and report BLOCKED with the numbers.
- **Every mainnet transaction is signed by the owner.** The agent never broadcasts, never uses a private key, and never runs `cast send`, `cast wallet` or `forge script --broadcast`.
- Run every command in Git Bash, from the `contracts/` directory, unless stated otherwise. A new shell must load the env before running fork tests: `set -a; source .env; set +a`.
- The commit message ends with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

### Design decisions (so the reviewer does not have to guess)
- **"targetHF + buffer"** in the spec is merged into `targetHealthFactor`: the owner sets a target that already includes the buffer. One parameter fewer, same behavior.
- **Derisk window:** from `20:00 ET Friday − deriskWindow` to 20:00 ET Friday (when the Chainlink equity feed stops). Inside the window, BORROW and WITHDRAW_COLLATERAL while debt remains must keep HF ≥ `targetHealthFactor`; outside the window the floor is `minHealthFactor`. If the calendar read fails, treat it as **inside the window** (fail-closed). `deriskWindow = 0` disables the window. Maximum 12h.
- **BORROW** has an HF projection inside the vault (`projectedHealthFactorAfterBorrow`), so `previewIntent` reports `HEALTH_FACTOR_LOW` / `DERISK_WINDOW` correctly. **WITHDRAW_COLLATERAL while debt remains** has no projection (it would need the per-reserve collateral factor of each user): HF is checked only by the adapter after the withdrawal. `previewIntent` may return OK for an order for which `execute` returns `HEALTH_FACTOR_LOW`.
- **Concentration** also counts the collateral currently supplied (gross, debt not subtracted). If the collateral cannot be read, it returns `CONCENTRATION` (fail-closed).
- **Changing or disabling the credit adapter** is blocked while a position remains (`CreditPositionOpen`), because only the old vault can control the old adapter. A failed position read counts as a position still open.
- **Exit-only token:** with `allowed = false` but a feed or pool still present, it is still validated and its multiplier is tracked; SELL and WITHDRAW_COLLATERAL still work, BUY and SUPPLY are rejected. Removing both the feed and the pool is a complete delisting (SELL is no longer possible). WITHDRAW_COLLATERAL only needs the token to have been listed, so collateral never gets stuck in the adapter once the debt is gone.

## Review Focus

1. **Borrowed USDC recorded as revenue by mistake.** After BORROW, `notifyRevenue()` must return 0, and revenue that arrives afterwards must still be recorded correctly. Test: `test_borrowedUsdcIsNotRevenue` (Task 4).
2. **The owner changes or disables the credit adapter while debt or collateral remains**, leaving the position orphaned in the old adapter. `applyMandate` must revert `CreditPositionOpen`. Test: `test_cannotSwitchAdapterWithOpenPosition`, `test_cannotDisableCreditWithSuppliedCollateral`, `test_unreadablePositionCountsAsOpen` (Task 1).
3. **The adapter reverts with empty data, a Panic, or a wrong-length error.** `execute()` must still emit `Decision(CREDIT_FAILED)`, not revert, and not change state. Test: `test_adapterRevertNeverRevertsExecute` (Task 4).
4. **Interest accrues between the agent reading the debt and the REPAY**, or the agent overpays. The adapter pulls exactly the debt, the remainder stays in the vault, and no USDC gets stuck in the adapter; repaying when there is no debt is a no-op. Test: `test_repayPullsOnlyDebtAndSweeps`, `test_repayWithoutDebtIsNoop` (Task 6), `test_creditLoopInSession` (Task 8).
5. **The calendar says the market is open but the collateral feed has already stopped** (for example a holiday that is not in the calendar yet). BORROW must be blocked with `FEED_STALE`, while REPAY and SUPPLY still work. Test: `test_staleCollateralFeedBlocksBorrowNotRepay` (Task 4).

---

## File Structure

```
contracts/
  src/
    Types.sol                         (modify) Mandate + 4 credit fields; Reason + 3 values; Intent doc
    GuardLib.sol                      (modify) tokenPaused, marketOpen, transferable, collateralHealthy
    MandateVault.sol                  (modify) _checkCredit, _performCredit, derisk, exit-only, blocking adapter changes
    adapters/ICreditAdapter.sol       (new)    interface + shared errors
    adapters/AaveV4CreditAdapter.sol  (new)    Aave V4 position of one vault
    interfaces/IAaveV4.sol            (new)    ISpoke subset + oracle
  script/
    BaseAddresses.sol                 (modify) Aave addresses + reserve IDs
    MaatConfig.sol                    (modify) defaultMandate(…, creditAdapter), creditReserves()
    Deploy.s.sol                      (modify) deploy 4 contracts, precompute the vault address
  test/
    mocks/MockCreditAdapter.sol       (new)    mock adapter, HF / reverts are controllable
    mocks/MockSpoke.sol               (new)    mock spoke + oracle for the adapter unit tests
    utils/VaultFixture.sol            (modify) new mandate fields, _deployVault helper
    utils/CreditFixture.sol           (new)    vault with credit enabled, using MockCreditAdapter
    MandateVaultCredit.t.sol          (new)    Task 1, 3, 4, 5
    MandateVault.t.sol                (modify) Task 3, 5
    GuardLib.t.sol                    (modify) Task 2
    AaveV4CreditAdapter.t.sol         (new)    Task 6
    fork/AaveV4CreditAdapterFork.t.sol  (new)    Task 7
    fork/MandateVaultCreditFork.t.sol   (new)    Task 8
    fork/MandateVaultFork.t.sol       (modify) new MaatConfig signature
    fork/DeployFork.t.sol             (modify) Task 1, 9
  .env.example                        (modify) MAAT_DEPLOYER
deployments/README.md                 (modify) Task 9
```

Each task ends with one commit, the tests of that task pass, and all the old unit tests still pass.

---

### Task 1: Mandate v1, ICreditAdapter, validation and blocking adapter changes

**Files:**
- Modify: `contracts/src/Types.sol`
- Create: `contracts/src/adapters/ICreditAdapter.sol`
- Modify: `contracts/src/MandateVault.sol` (import, error, constant, `applyMandate`, `_requireValidMandate`)
- Create: `contracts/test/mocks/MockCreditAdapter.sol`
- Modify: `contracts/test/utils/VaultFixture.sol`
- Create: `contracts/test/utils/CreditFixture.sol`
- Create: `contracts/test/MandateVaultCredit.t.sol`
- Modify: `contracts/test/MandateVault.t.sol` (add 1 test)
- Modify: `contracts/script/MaatConfig.sol`, `contracts/script/Deploy.s.sol`, `contracts/test/fork/DeployFork.t.sol`, `contracts/test/fork/MandateVaultFork.t.sol`

**Interfaces:**
- Consumes: Plan 1 `MandateVault`, `VaultFixture` (`_intent`, `_exec`, `_assertReason`, `_queueMandateAndWait`, `defaultMandate`).
- Produces:
  - `Mandate` adds (in order, after `swapAdapter`): `address creditAdapter; uint64 minHealthFactor; uint64 targetHealthFactor; uint32 deriskWindow;`
  - `Reason` adds: `CREDIT_FAILED`, `HEALTH_FACTOR_LOW`, `DERISK_WINDOW`.
  - `interface ICreditAdapter` (all the functions as in the code below), errors `NotVault()`, `UnsupportedToken(address)`, `HealthFactorTooLow(uint256 healthFactor, uint256 minHealthFactor)`.
  - `MandateVault.CreditPositionOpen()` error.
  - `MockCreditAdapter(address vault_, address usdc_)` with the test setters `setSupported`, `setSupplied`, `setDebt`, `setHealthFactor`, `setProjectedHf`, `setNextHf`, `setCustodian`, `setOperator`, `setMutationsRevert(bool, bytes)`, `setViewsRevert(bool)`, and the getters `lastMinHf()`, `nextHf()`.
  - `VaultFixture._deployVault(Mandate memory) returns (MandateVault)`.
  - `CreditFixture`: `credit`, `creditMandate()`, `_deployCreditVault(Mandate memory) returns (MandateVault, MockCreditAdapter)`, `deployVaultExternal(Mandate memory)`, `_creditIntent(Action, address, uint256)`, `_execCredit(Action, address, uint256) returns (Reason)`, `_supplyAll()`, `_warpFresh(uint256)`, constants `FRI_1300_ET`, `FRI_1400_ET`, `FRI_1500_ET`, `MIN_HF`, `TARGET_HF`.
  - `MaatConfig.defaultMandate(SessionMode mode, address calendar, address swapAdapter, address creditAdapter)`, constants `MIN_HEALTH_FACTOR`, `TARGET_HEALTH_FACTOR`, `DERISK_WINDOW`.

- [ ] **Step 1: Extend `Types.sol`**

In `enum Reason`, replace the last line:

```solidity
    TRANSFER_FAILED // appended: token transfer/approve failed inside execute(); never reorder this enum
```

with:

```solidity
    TRANSFER_FAILED, // appended: token transfer/approve failed inside execute(); never reorder this enum
    CREDIT_FAILED, // appended (Plan 2A): credit adapter call reverted or a credit view was unreadable
    HEALTH_FACTOR_LOW, // appended (Plan 2A): health factor after the action would be below minHealthFactor
    DERISK_WINDOW // appended (Plan 2A): inside the Friday derisk window, below targetHealthFactor
```

Replace the doc comment of `Intent`:

```solidity
/// @notice BUY: amount = USDC in (6 decimals). SELL / SUPPLY / WITHDRAW_COLLATERAL: token = stock, amount = raw
/// stock amount. BORROW / REPAY: token = USDC, amount = USDC. PAY_EXPENSE: USDC to `payee`.
```

In `struct Mandate`, after `address swapAdapter;` add:

```solidity
    /// Credit venue; address(0) disables SUPPLY / WITHDRAW_COLLATERAL / BORROW / REPAY.
    address creditAdapter;
    uint64 minHealthFactor; // WAD; risk-increasing credit actions must leave HF >= this
    uint64 targetHealthFactor; // WAD; required instead of minHealthFactor inside the derisk window
    uint32 deriskWindow; // seconds before Fri 20:00 ET (Chainlink equity feeds stop); 0 = no window
```

- [ ] **Step 2: Create `src/adapters/ICreditAdapter.sol`**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice One lending position owned by one MandateVault. Stock amounts are raw units, USDC has 6 decimals,
/// health factors are WAD (1e18 = 1.00; type(uint256).max with no debt).
/// @dev The vault trusts the adapter's return data (the adapter is allowlisted in the mandate and checked to be
/// bound to the vault); reverts are contained by the vault's try/catch.
interface ICreditAdapter {
    error NotVault();
    error UnsupportedToken(address token);
    /// @notice Raised by borrow/withdraw when the health factor after the action is below the minimum.
    error HealthFactorTooLow(uint256 healthFactor, uint256 minHealthFactor);

    function vault() external view returns (address);
    function usdc() external view returns (address);

    /// @notice Pulls `amount` of `token` from the vault (approve first), supplies it and enables it as collateral.
    function supply(address token, uint256 amount) external;
    /// @notice Withdraws collateral to the vault. Reverts HealthFactorTooLow if HF ends below `minHealthFactor`.
    function withdraw(address token, uint256 amount, uint256 minHealthFactor) external returns (uint256 withdrawn);
    /// @notice Borrows USDC to the vault. Reverts HealthFactorTooLow if HF ends below `minHealthFactor`.
    function borrow(uint256 amount, uint256 minHealthFactor) external;
    /// @notice Pulls min(amount, debt) USDC from the vault (approve `amount` first) and repays it.
    function repay(uint256 amount) external returns (uint256 repaid);

    function supportsToken(address token) external view returns (bool);
    function suppliedOf(address token) external view returns (uint256);
    function debt() external view returns (uint256);
    function healthFactor() external view returns (uint256);
    function projectedHealthFactorAfterBorrow(uint256 amount) external view returns (uint256);
    /// @notice True while any debt or supplied collateral remains; the vault refuses to switch adapters then.
    function hasPosition() external view returns (bool);
    /// @notice Holds supplied `token` and sends it out on withdraw (B20 sender / receiver / executor legs).
    function collateralCustodian(address token) external view returns (address);
    /// @notice Pulls supplied tokens from the adapter (B20 executor leg).
    function collateralOperator() external view returns (address);
}
```

- [ ] **Step 3: Create `test/mocks/MockCreditAdapter.sol`**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ICreditAdapter} from "../../src/adapters/ICreditAdapter.sol";
import {IERC20Minimal} from "../../src/interfaces/IExternal.sol";

/// @notice Scriptable credit venue. Moves real (mock) tokens; health factors are whatever the test sets.
contract MockCreditAdapter is ICreditAdapter {
    address public immutable vault;
    address public immutable usdc;

    mapping(address => bool) internal _supported;
    mapping(address => uint256) internal _supplied;
    uint256 internal _totalSupplied;
    uint256 internal _debt;
    uint256 internal _healthFactor = type(uint256).max;
    uint256 internal _projectedHf = type(uint256).max;
    /// Health factor the venue reports after borrow/withdraw.
    uint256 public nextHf = type(uint256).max;
    /// minHealthFactor passed by the vault on the last successful borrow/withdraw.
    uint256 public lastMinHf;
    address internal _custodian;
    address internal _operator;

    bool public mutationsRevert;
    bytes internal _revertData;
    bool public viewsRevert;

    error ViewReverted();

    modifier onlyVault() {
        if (msg.sender != vault) revert NotVault();
        _;
    }

    modifier mayRevert() {
        if (mutationsRevert) {
            bytes memory d = _revertData;
            assembly ("memory-safe") {
                revert(add(d, 0x20), mload(d))
            }
        }
        _;
    }

    modifier viewGuard() {
        if (viewsRevert) revert ViewReverted();
        _;
    }

    constructor(address vault_, address usdc_) {
        vault = vault_;
        usdc = usdc_;
        _custodian = address(this);
        _operator = address(this);
    }

    // ---------------------------------------------------------------- test controls

    function setSupported(address token, bool s) external {
        _supported[token] = s;
    }

    function setSupplied(address token, uint256 amount) external {
        _totalSupplied = _totalSupplied - _supplied[token] + amount;
        _supplied[token] = amount;
    }

    function setDebt(uint256 d) external {
        _debt = d;
    }

    function setHealthFactor(uint256 hf) external {
        _healthFactor = hf;
    }

    function setProjectedHf(uint256 hf) external {
        _projectedHf = hf;
    }

    function setNextHf(uint256 hf) external {
        nextHf = hf;
    }

    function setCustodian(address c) external {
        _custodian = c;
    }

    function setOperator(address o) external {
        _operator = o;
    }

    function setMutationsRevert(bool on, bytes calldata data) external {
        mutationsRevert = on;
        _revertData = data;
    }

    function setViewsRevert(bool on) external {
        viewsRevert = on;
    }

    // ---------------------------------------------------------------- mutations

    function supply(address token, uint256 amount) external onlyVault mayRevert {
        if (!_supported[token]) revert UnsupportedToken(token);
        IERC20Minimal(token).transferFrom(vault, address(this), amount);
        _supplied[token] += amount;
        _totalSupplied += amount;
    }

    function withdraw(address token, uint256 amount, uint256 minHealthFactor)
        external
        onlyVault
        mayRevert
        returns (uint256)
    {
        lastMinHf = minHealthFactor;
        if (nextHf < minHealthFactor) revert HealthFactorTooLow(nextHf, minHealthFactor);
        _supplied[token] -= amount;
        _totalSupplied -= amount;
        IERC20Minimal(token).transfer(vault, amount);
        return amount;
    }

    function borrow(uint256 amount, uint256 minHealthFactor) external onlyVault mayRevert {
        lastMinHf = minHealthFactor;
        if (nextHf < minHealthFactor) revert HealthFactorTooLow(nextHf, minHealthFactor);
        _debt += amount;
        IERC20Minimal(usdc).transfer(vault, amount);
    }

    function repay(uint256 amount) external onlyVault mayRevert returns (uint256 repaid) {
        repaid = amount < _debt ? amount : _debt;
        if (repaid != 0) IERC20Minimal(usdc).transferFrom(vault, address(this), repaid);
        _debt -= repaid;
    }

    // ---------------------------------------------------------------- views

    function supportsToken(address token) external view viewGuard returns (bool) {
        return _supported[token];
    }

    function suppliedOf(address token) external view viewGuard returns (uint256) {
        return _supplied[token];
    }

    function debt() external view viewGuard returns (uint256) {
        return _debt;
    }

    function healthFactor() external view viewGuard returns (uint256) {
        return _healthFactor;
    }

    function projectedHealthFactorAfterBorrow(uint256) external view viewGuard returns (uint256) {
        return _projectedHf;
    }

    function hasPosition() external view viewGuard returns (bool) {
        return _debt != 0 || _totalSupplied != 0;
    }

    function collateralCustodian(address) external view viewGuard returns (address) {
        return _custodian;
    }

    function collateralOperator() external view viewGuard returns (address) {
        return _operator;
    }
}
```

- [ ] **Step 4: Edit `VaultFixture.sol`**

In `defaultMandate()`, after `swapAdapter: address(adapter)` add (remember the comma after `address(adapter)`):

```solidity
            swapAdapter: address(adapter),
            creditAdapter: address(0),
            minHealthFactor: 0,
            targetHealthFactor: 0,
            deriskWindow: 0
```

In `setUp()`, replace the section from `address[] memory toks = new address[](1);` through the end of the line `vault = new MandateVault(...)` with:

```solidity
        vault = _deployVault(defaultMandate());
```

and add the helper (placed right after `setUp()`):

```solidity
    /// @dev The fixture's one-token (NVDAc) vault with one payee, under mandate `m`.
    function _deployVault(Mandate memory m) internal returns (MandateVault) {
        address[] memory toks = new address[](1);
        toks[0] = address(nvda);
        TokenConfig[] memory cfgs = new TokenConfig[](1);
        cfgs[0] = TokenConfig({allowed: true, feed: address(feed), pool: address(pool), maxWeightBps: 4000});
        address[] memory payees = new address[](1);
        payees[0] = payee;
        return new MandateVault(owner, executor, address(usdc), address(registry), m, toks, cfgs, payees);
    }
```

- [ ] **Step 5: Create `test/utils/CreditFixture.sol`**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {VaultFixture} from "./VaultFixture.sol";
import {MandateVault} from "../../src/MandateVault.sol";
import {Action, Reason, Intent, Mandate} from "../../src/Types.sol";
import {MockCreditAdapter} from "../mocks/MockCreditAdapter.sol";

/// @notice VaultFixture with credit enabled through a MockCreditAdapter. The vault holds 200 USDC and 1 NVDAc
/// ($200); the adapter holds 1,000 USDC to lend.
abstract contract CreditFixture is VaultFixture {
    uint256 internal constant FRI_1300_ET = 1793988000; // Fri 2026-11-06 18:00 UTC
    uint256 internal constant FRI_1400_ET = 1793991600; // Fri 2026-11-06 19:00 UTC
    uint256 internal constant FRI_1500_ET = 1793995200; // Fri 2026-11-06 20:00 UTC
    uint64 internal constant MIN_HF = 1.5e18;
    uint64 internal constant TARGET_HF = 2e18;

    MockCreditAdapter internal credit;

    function setUp() public virtual override {
        super.setUp();
        (vault, credit) = _deployCreditVault(creditMandate());
        usdc.mint(address(vault), 200e6);
        vault.notifyRevenue();
        nvda.mint(address(vault), 1e8);
    }

    /// @dev deriskWindow is 6h so Fri 14:00-16:00 ET (REGULAR market still open) falls inside the window.
    function creditMandate() internal view returns (Mandate memory m) {
        m = defaultMandate();
        m.minHealthFactor = MIN_HF;
        m.targetHealthFactor = TARGET_HF;
        m.deriskWindow = 6 hours;
    }

    /// @dev Deploys the adapter at nonce n, bound to the address the vault gets at nonce n + 1, then the vault.
    function _deployCreditVault(Mandate memory m) internal returns (MandateVault v, MockCreditAdapter a) {
        address predicted = vm.computeCreateAddress(address(this), vm.getNonce(address(this)) + 1);
        a = new MockCreditAdapter(predicted, address(usdc));
        a.setSupported(address(nvda), true);
        usdc.mint(address(a), 1_000e6);
        m.creditAdapter = address(a);
        v = _deployVault(m);
        assertEq(address(v), predicted);
    }

    /// @dev External so constructor reverts can be caught with vm.expectRevert.
    function deployVaultExternal(Mandate memory m) external returns (MandateVault) {
        return _deployVault(m);
    }

    function _creditIntent(Action a, address token, uint256 amount) internal returns (Intent memory i) {
        i = _intent(a, amount);
        i.token = token;
    }

    function _execCredit(Action a, address token, uint256 amount) internal returns (Reason reason) {
        (, reason) = _exec(_creditIntent(a, token, amount));
    }

    function _supplyAll() internal {
        _assertReason(_execCredit(Action.SUPPLY, address(nvda), 1e8), Reason.OK);
    }

    /// @dev Warps and refreshes the collateral feed so FEED_STALE cannot mask the check under test.
    function _warpFresh(uint256 ts) internal {
        vm.warp(ts);
        feed.set(200e8, ts);
    }
}
```

- [ ] **Step 6: Write the configuration tests (fail)**

Create `test/MandateVaultCredit.t.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {CreditFixture} from "./utils/CreditFixture.sol";
import {MandateVault} from "../src/MandateVault.sol";
import {Action, Reason, Intent, Mandate, TokenConfig} from "../src/Types.sol";
import {ICreditAdapter} from "../src/adapters/ICreditAdapter.sol";
import {B20Constants} from "../src/interfaces/IB20Asset.sol";
import {MockCreditAdapter} from "./mocks/MockCreditAdapter.sol";

contract MandateVaultCreditTest is CreditFixture {
    // ------------------------------------------------------------------ config (Task 1)

    function test_creditMandateIsAccepted() public view {
        Mandate memory m = vault.mandate();
        assertEq(m.creditAdapter, address(credit));
        assertEq(m.minHealthFactor, MIN_HF);
        assertEq(m.targetHealthFactor, TARGET_HF);
        assertEq(m.deriskWindow, 6 hours);
    }

    function test_rejectsAdapterWithoutCode() public {
        Mandate memory m = creditMandate();
        m.creditAdapter = makeAddr("noCodeAdapter");
        vm.expectRevert(MandateVault.InvalidConfig.selector);
        this.deployVaultExternal(m);
    }

    function test_rejectsAdapterBoundToAnotherVault() public {
        Mandate memory m = creditMandate();
        m.creditAdapter = address(new MockCreditAdapter(makeAddr("otherVault"), address(usdc)));
        vm.expectRevert(MandateVault.InvalidConfig.selector);
        this.deployVaultExternal(m);
    }

    function test_rejectsAdapterWithOtherUsdc() public {
        Mandate memory m = creditMandate();
        address predicted = vm.computeCreateAddress(address(this), vm.getNonce(address(this)) + 1);
        m.creditAdapter = address(new MockCreditAdapter(predicted, makeAddr("otherUsdc")));
        vm.expectRevert(MandateVault.InvalidConfig.selector);
        this.deployVaultExternal(m);
    }

    function test_rejectsBadHealthFactorBounds() public {
        Mandate memory m = creditMandate();
        m.minHealthFactor = 0.99e18;
        _expectCreditConfigRevert(m);
        m = creditMandate();
        m.targetHealthFactor = MIN_HF - 1;
        _expectCreditConfigRevert(m);
        m = creditMandate();
        m.deriskWindow = 12 hours + 1;
        _expectCreditConfigRevert(m);
    }

    function test_acceptsBoundaryHealthFactorBounds() public {
        Mandate memory m = creditMandate();
        m.minHealthFactor = 1e18;
        m.targetHealthFactor = 1e18;
        m.deriskWindow = 12 hours;
        (MandateVault v,) = _deployCreditVault(m);
        assertEq(v.mandate().deriskWindow, 12 hours);
    }

    function test_cannotSwitchAdapterWithOpenPosition() public {
        credit.setDebt(1e6);
        Mandate memory m = vault.mandate();
        m.creditAdapter = address(new MockCreditAdapter(address(vault), address(usdc)));
        _queueMandateAndWait(m);
        vm.prank(owner);
        vm.expectRevert(MandateVault.CreditPositionOpen.selector);
        vault.applyMandate(m);
    }

    function test_cannotDisableCreditWithSuppliedCollateral() public {
        credit.setSupplied(address(nvda), 1e8);
        Mandate memory m = vault.mandate();
        m.creditAdapter = address(0);
        _queueMandateAndWait(m);
        vm.prank(owner);
        vm.expectRevert(MandateVault.CreditPositionOpen.selector);
        vault.applyMandate(m);
    }

    function test_unreadablePositionCountsAsOpen() public {
        credit.setViewsRevert(true);
        Mandate memory m = vault.mandate();
        m.creditAdapter = address(0);
        _queueMandateAndWait(m);
        vm.prank(owner);
        vm.expectRevert(MandateVault.CreditPositionOpen.selector);
        vault.applyMandate(m);
    }

    function test_canSwitchAdapterWhenFlat() public {
        Mandate memory m = vault.mandate();
        MockCreditAdapter next = new MockCreditAdapter(address(vault), address(usdc));
        m.creditAdapter = address(next);
        _queueMandateAndWait(m);
        vm.prank(owner);
        vault.applyMandate(m);
        assertEq(vault.mandate().creditAdapter, address(next));
    }

    function test_canRetuneSameAdapterWithOpenPosition() public {
        credit.setDebt(1e6);
        Mandate memory m = vault.mandate();
        m.targetHealthFactor = 2.5e18;
        _queueMandateAndWait(m);
        vm.prank(owner);
        vault.applyMandate(m);
        assertEq(vault.mandate().targetHealthFactor, 2.5e18);
    }

    /// @dev Binds a fresh adapter to the address the next vault deployment gets, so only `m`'s bounds can fail.
    function _expectCreditConfigRevert(Mandate memory m) internal {
        address predicted = vm.computeCreateAddress(address(this), vm.getNonce(address(this)) + 1);
        m.creditAdapter = address(new MockCreditAdapter(predicted, address(usdc)));
        vm.expectRevert(MandateVault.InvalidConfig.selector);
        this.deployVaultExternal(m);
    }
}
```

In `test/MandateVault.t.sol`, right after `test_unsupportedActionsAreRefused`, add:

```solidity
    function test_creditActionsRefusedWhenCreditDisabled() public {
        Action[4] memory acts = [Action.SUPPLY, Action.WITHDRAW_COLLATERAL, Action.BORROW, Action.REPAY];
        for (uint256 k; k < acts.length; ++k) {
            (, Reason r) = _exec(_intent(acts[k], 1e6));
            _assertReason(r, Reason.ACTION_NOT_SUPPORTED);
        }
    }
```

- [ ] **Step 7: Run the tests to see them fail**

Run: `forge test --match-path test/MandateVaultCredit.t.sol`
Expected: FAIL at compile: `Member "CreditPositionOpen" not found` (or a `Mandate` struct error in `MaatConfig.sol` / the fork tests because of the missing fields). This is the expected failure.

- [ ] **Step 8: Implement in `MandateVault.sol`**

Add the import:

```solidity
import {ICreditAdapter} from "./adapters/ICreditAdapter.sol";
```

Add the constant right below `uint256 internal constant BPS = 10_000;`:

```solidity
    uint256 internal constant WAD = 1e18;
    uint256 internal constant MAX_DERISK_WINDOW = 12 hours;
```

Add the error after `error ChangeExpired(bytes32 changeHash);`:

```solidity
    error CreditPositionOpen();
```

Replace `applyMandate` with:

```solidity
    function applyMandate(Mandate calldata m) external onlyOwner {
        _consume(mandateChangeHash(m));
        _requireValidMandate(m);
        _requireNoOrphanedPosition(m.creditAdapter);
        _mandate = m;
        emit MandateApplied(keccak256(abi.encode(m)));
        emit PolicyHashUpdated(policyHash());
    }
```

Replace `_requireValidMandate` with:

```solidity
    /// @dev Config-time validation only (constructor / timelocked apply); never called from execute().
    /// GuardLib's try/catch cannot cover calls to addresses without code, so contracts are checked here.
    function _requireValidMandate(Mandate memory m) internal view {
        if (m.calendar.code.length == 0 || m.swapAdapter.code.length == 0) revert InvalidConfig();
        if (m.maxSlippageBps > BPS) revert InvalidConfig();
        if (m.creditAdapter != address(0)) _requireValidCredit(m);
    }

    /// @dev The adapter must be a contract bound to this vault and its USDC, so the vault can never route
    /// collateral into a position it does not control.
    function _requireValidCredit(Mandate memory m) internal view {
        if (m.creditAdapter.code.length == 0) revert InvalidConfig();
        if (m.minHealthFactor < WAD || m.targetHealthFactor < m.minHealthFactor) revert InvalidConfig();
        if (m.deriskWindow > MAX_DERISK_WINDOW) revert InvalidConfig();
        ICreditAdapter ca = ICreditAdapter(m.creditAdapter);
        try ca.vault() returns (address v) {
            if (v != address(this)) revert InvalidConfig();
        } catch {
            revert InvalidConfig();
        }
        try ca.usdc() returns (address u) {
            if (u != usdc) revert InvalidConfig();
        } catch {
            revert InvalidConfig();
        }
    }

    /// @dev Only this vault can move a position held by its adapter, so switching or disabling the adapter
    /// while debt or collateral remains would strand it. Fail-closed: an unreadable position counts as open.
    function _requireNoOrphanedPosition(address next) internal view {
        address current = _mandate.creditAdapter;
        if (current == address(0) || current == next) return;
        try ICreditAdapter(current).hasPosition() returns (bool open) {
            if (open) revert CreditPositionOpen();
        } catch {
            revert CreditPositionOpen();
        }
    }
```

- [ ] **Step 9: Update `MaatConfig` and the call sites**

Replace `defaultMandate` in `script/MaatConfig.sol` with:

```solidity
    /// Credit defaults (spec §3.2). targetHealthFactor already includes the spec's "targetHF + buffer".
    uint64 internal constant MIN_HEALTH_FACTOR = 1.5e18;
    uint64 internal constant TARGET_HEALTH_FACTOR = 2e18;
    uint32 internal constant DERISK_WINDOW = 4 hours;

    function defaultMandate(SessionMode mode, address calendar, address swapAdapter, address creditAdapter)
        internal
        pure
        returns (Mandate memory)
    {
        return Mandate({
            sessionMode: mode,
            // 100 not 50: measured in-session TWAP(1800s)-vs-Chainlink premiums at BLOCK_SESSION were
            // NVDAc 53 bps, GOOGLc 49 bps, AAPLc 29 bps (research/04-onchain-findings.md).
            maxPremiumBps: 100,
            maxSlippageBps: 100,
            maxStaleness: 3600,
            multiplierCooldown: 1 days,
            twapWindow: 1800,
            perTradeCapUsd: 50e6,
            dailyCapUsd: 100e6,
            calendar: calendar,
            swapAdapter: swapAdapter,
            creditAdapter: creditAdapter,
            minHealthFactor: MIN_HEALTH_FACTOR,
            targetHealthFactor: TARGET_HEALTH_FACTOR,
            deriskWindow: DERISK_WINDOW
        });
    }
```

Add `address(0)` as the last argument at 3 call sites (Task 9 will replace the ones in `Deploy.s.sol` and `DeployFork.t.sol`):
- `script/Deploy.s.sol`: `MaatConfig.defaultMandate(SessionMode.REGULAR, address(calendar), address(adapter), address(0))`
- `test/fork/DeployFork.t.sol`: `MaatConfig.defaultMandate(SessionMode.REGULAR, address(calendar), address(adapter), address(0))`
- `test/fork/MandateVaultFork.t.sol`: `MaatConfig.defaultMandate(mode, address(calendar), address(adapter), address(0))`

- [ ] **Step 10: Run the tests to see them pass**

Run: `forge test --no-match-path "test/fork/*"`
Expected: all PASS, including the 11 new tests in `MandateVaultCredit.t.sol` and `test_creditActionsRefusedWhenCreditDisabled`.

Run (needs RPC): `set -a; source .env; set +a; forge test --match-path "test/fork/*"`
Expected: all Plan 1 fork tests PASS (the mandate hash in `DeployFork` now includes the 4 new fields).

- [ ] **Step 11: Commit**

```bash
git add src/Types.sol src/adapters/ICreditAdapter.sol src/MandateVault.sol test/mocks/MockCreditAdapter.sol test/utils/VaultFixture.sol test/utils/CreditFixture.sol test/MandateVaultCredit.t.sol test/MandateVault.t.sol script/MaatConfig.sol script/Deploy.s.sol test/fork/DeployFork.t.sol test/fork/MandateVaultFork.t.sol
git commit -m "feat: add credit fields to the mandate and the ICreditAdapter interface

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: GuardLib credit helpers

**Files:**
- Modify: `contracts/src/GuardLib.sol`
- Modify: `contracts/test/GuardLib.t.sol`

**Interfaces:**
- Consumes: Plan 1 `GuardLib.checkMarket`, `multiplierBlocked`, `authorized`, `PriceLib.readFeed`, `MarketCalendar.isOpen`.
- Produces (all `internal view`):
  - `struct CollateralCheck { address token; address feed; uint32 maxStaleness; uint32 multiplierCooldown; uint256 lastMultiplier; uint256 multiplierChangedAt; }`
  - `tokenPaused(address token) returns (bool)` — fail-closed (revert ⇒ true).
  - `marketOpen(address calendar, SessionMode mode) returns (bool)` — fail-closed (revert ⇒ false).
  - `collateralHealthy(CollateralCheck memory c) returns (Reason)` — `TOKEN_PAUSED` → `BAD_PRICE` (the feed has no code, or the read fails) → `FEED_STALE` → `MULTIPLIER_COOLDOWN` → `OK`. Does not check market hours.
  - `transferable(address token, address registry, address[] memory senders, address[] memory receivers, address[] memory executors) returns (bool)` — every leg must be authorized; `tx.origin` is always checked as an executor.
  - `checkMarket` keeps its behavior, only refactored to use `tokenPaused` and `marketOpen`.

- [ ] **Step 1: Write the tests (fail)**

In `test/GuardLib.t.sol`, add to `contract GuardHarness`:

```solidity
    function collateral(GuardLib.CollateralCheck memory c) external view returns (Reason) {
        return GuardLib.collateralHealthy(c);
    }

    function open(address calendar, SessionMode mode) external view returns (bool) {
        return GuardLib.marketOpen(calendar, mode);
    }

    function paused(address token) external view returns (bool) {
        return GuardLib.tokenPaused(token);
    }

    function transferable(
        address token,
        address registry,
        address[] memory senders,
        address[] memory receivers,
        address[] memory executors
    ) external view returns (bool) {
        return GuardLib.transferable(token, registry, senders, receivers, executors);
    }
```

In `contract GuardLibTest`, add the constant next to `THU_1030_ET`:

```solidity
    uint256 internal constant SAT_1300_ET = 1793469600;
    address internal constant HUB = address(0x4B);
    address internal constant SPOKE = address(0x5B);
```

and add the tests at the end of the contract:

```solidity
    // ------------------------------------------------------------------ credit helpers (Plan 2A)

    function _cc() internal view returns (GuardLib.CollateralCheck memory) {
        return GuardLib.CollateralCheck({
            token: address(nvda),
            feed: address(feed),
            maxStaleness: 3600,
            multiplierCooldown: 1 days,
            lastMultiplier: 1e18,
            multiplierChangedAt: 0
        });
    }

    function _expectCollateral(GuardLib.CollateralCheck memory c, Reason want) internal view {
        assertEq(uint8(h.collateral(c)), uint8(want));
    }

    function test_collateralHealthy() public view {
        _expectCollateral(_cc(), Reason.OK);
    }

    function test_collateralPaused() public {
        nvda.setPaused(B20Constants.FEATURE_TRANSFER, true);
        _expectCollateral(_cc(), Reason.TOKEN_PAUSED);
    }

    function test_collateralPauseReadFailsClosed() public {
        nvda.setReverts(true, false, false, false);
        _expectCollateral(_cc(), Reason.TOKEN_PAUSED);
        assertTrue(h.paused(address(nvda)));
    }

    function test_collateralFeedWithoutCodeIsBadPrice() public view {
        GuardLib.CollateralCheck memory c = _cc();
        c.feed = address(0);
        _expectCollateral(c, Reason.BAD_PRICE);
    }

    function test_collateralNegativePriceIsBadPrice() public {
        feed.set(-1, THU_1030_ET);
        _expectCollateral(_cc(), Reason.BAD_PRICE);
    }

    function test_collateralStaleFeed() public {
        feed.set(200e8, THU_1030_ET - 3601);
        _expectCollateral(_cc(), Reason.FEED_STALE);
    }

    function test_collateralMultiplierChange() public {
        nvda.setUiMultiplier(2e18);
        _expectCollateral(_cc(), Reason.MULTIPLIER_COOLDOWN);
    }

    function test_collateralIgnoresMarketHours() public {
        vm.warp(SAT_1300_ET);
        feed.set(200e8, SAT_1300_ET);
        _expectCollateral(_cc(), Reason.OK);
    }

    function test_marketOpenInSession() public view {
        assertTrue(h.open(address(calendar), SessionMode.REGULAR));
    }

    function test_marketClosedOnSaturday() public {
        vm.warp(SAT_1300_ET);
        assertFalse(h.open(address(calendar), SessionMode.REGULAR));
        assertFalse(h.open(address(calendar), SessionMode.FEED_24_5));
    }

    function test_revertingCalendarCountsAsClosed() public {
        assertFalse(h.open(address(new MockReverter()), SessionMode.REGULAR));
    }

    function test_tokenNotPaused() public view {
        assertFalse(h.paused(address(nvda)));
    }

    /// @dev Policy for `scope` that authorizes every account in this test except `blocked`.
    function _blockOnly(bytes32 scope, address blocked) internal {
        uint64 id = nextPolicyId++;
        nvda.setPolicyId(scope, id);
        address[5] memory all = [VAULT, ADAPTER, HUB, SPOKE, ORIGIN];
        for (uint256 i; i < all.length; ++i) {
            registry.setAuthorized(id, all[i], all[i] != blocked);
        }
    }

    /// @dev Supply-shaped path: vault -> adapter -> hub, pulled by the adapter then the spoke.
    function _transferable() internal returns (bool) {
        address[] memory s = new address[](2);
        s[0] = VAULT;
        s[1] = ADAPTER;
        address[] memory r = new address[](2);
        r[0] = ADAPTER;
        r[1] = HUB;
        address[] memory e = new address[](2);
        e[0] = ADAPTER;
        e[1] = SPOKE;
        vm.prank(address(this), ORIGIN);
        return h.transferable(address(nvda), address(registry), s, r, e);
    }

    function test_transferableWhenEveryLegIsAllowed() public {
        assertTrue(_transferable());
    }

    function test_transferableBlockedSender() public {
        _blockOnly(B20Constants.TRANSFER_SENDER_POLICY, ADAPTER);
        assertFalse(_transferable());
    }

    function test_transferableBlockedReceiver() public {
        _blockOnly(B20Constants.TRANSFER_RECEIVER_POLICY, HUB);
        assertFalse(_transferable());
    }

    function test_transferableBlockedExecutor() public {
        _blockOnly(B20Constants.TRANSFER_EXECUTOR_POLICY, SPOKE);
        assertFalse(_transferable());
    }

    function test_transferableChecksTxOrigin() public {
        _blockOnly(B20Constants.TRANSFER_EXECUTOR_POLICY, ORIGIN);
        assertFalse(_transferable());
    }

    function test_transferablePolicyReadFailsClosed() public {
        nvda.setReverts(false, true, false, false);
        assertFalse(_transferable());
    }
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `forge test --match-path test/GuardLib.t.sol`
Expected: FAIL at compile: `Member "CollateralCheck" not found or not visible after argument-dependent lookup in type(library GuardLib)`.

- [ ] **Step 3: Implement in `GuardLib.sol`**

Add the struct right after `struct MarketCheck { … }`:

```solidity
    /// @notice A token held as lending collateral: checks 2, 5 and 6 only (no trade, so no premium or path).
    struct CollateralCheck {
        address token;
        address feed;
        uint32 maxStaleness;
        uint32 multiplierCooldown;
        uint256 lastMultiplier;
        uint256 multiplierChangedAt;
    }
```

In `checkMarket`, replace the block `try t.isPaused(...) { ... } catch { ... }` with:

```solidity
        if (tokenPaused(c.token)) return (Reason.TOKEN_PAUSED, 0);
```

and replace the block `try MarketCalendar(c.calendar).isOpen(...) { ... } catch { ... }` with:

```solidity
        if (!marketOpen(c.calendar, c.sessionMode)) return (Reason.MARKET_CLOSED, 0);
```

(keep the line `IB20Asset t = IB20Asset(c.token);` because `multiplierBlocked(t, …)` still uses it).

Add the following functions after `checkMarket`:

```solidity
    /// @dev Fail-closed: a reverting isPaused() counts as paused.
    function tokenPaused(address token) internal view returns (bool) {
        try IB20Asset(token).isPaused(B20Constants.FEATURE_TRANSFER) returns (bool p) {
            return p;
        } catch {
            return true;
        }
    }

    /// @dev Fail-closed: a reverting calendar counts as closed.
    function marketOpen(address calendar, SessionMode mode) internal view returns (bool) {
        try MarketCalendar(calendar).isOpen(block.timestamp, mode) returns (bool open) {
            return open;
        } catch {
            return false;
        }
    }

    /// @notice Collateral is safe to borrow against: not paused, live price, no multiplier change pending.
    /// @dev A feed address without code (a token whose market was removed) is BAD_PRICE, never a revert.
    function collateralHealthy(CollateralCheck memory c) internal view returns (Reason) {
        if (tokenPaused(c.token)) return Reason.TOKEN_PAUSED;
        if (c.feed.code.length == 0) return Reason.BAD_PRICE;
        (bool ok,, uint256 age) = PriceLib.readFeed(c.feed);
        if (!ok) return Reason.BAD_PRICE;
        if (age > c.maxStaleness) return Reason.FEED_STALE;
        if (multiplierBlocked(IB20Asset(c.token), c.lastMultiplier, c.multiplierChangedAt, c.multiplierCooldown)) {
            return Reason.MULTIPLIER_COOLDOWN;
        }
        return Reason.OK;
    }

    /// @notice Every sender, receiver and executor leg of a multi-hop B20 transfer is authorized. tx.origin is
    /// always checked as an executor too, as in transferPathAuthorized.
    function transferable(
        address token,
        address registry,
        address[] memory senders,
        address[] memory receivers,
        address[] memory executors
    ) internal view returns (bool) {
        for (uint256 i; i < senders.length; ++i) {
            if (!authorized(token, registry, B20Constants.TRANSFER_SENDER_POLICY, senders[i])) return false;
        }
        for (uint256 i; i < receivers.length; ++i) {
            if (!authorized(token, registry, B20Constants.TRANSFER_RECEIVER_POLICY, receivers[i])) return false;
        }
        for (uint256 i; i < executors.length; ++i) {
            if (!authorized(token, registry, B20Constants.TRANSFER_EXECUTOR_POLICY, executors[i])) return false;
        }
        return authorized(token, registry, B20Constants.TRANSFER_EXECUTOR_POLICY, tx.origin);
    }
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `forge test --match-path test/GuardLib.t.sol -vv`
Expected: all PASS, including the old `checkMarket` tests (the refactor does not change behavior) and 18 new tests.

Run: `forge test --no-match-path "test/fork/*"`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/GuardLib.sol test/GuardLib.t.sol
git commit -m "feat: add collateral, calendar and multi-leg policy helpers to GuardLib

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Vault SUPPLY / REPAY and concentration that also counts collateral

**Files:**
- Modify: `contracts/src/MandateVault.sol` (`_check`, `_perform`, `_weightAfterBuyBps`, add the credit functions)
- Modify: `contracts/test/MandateVaultCredit.t.sol`

**Interfaces:**
- Consumes: Task 1 `ICreditAdapter`, `Mandate.creditAdapter`, `CreditFixture`; Task 2 `GuardLib.tokenPaused`, `GuardLib.transferable`.
- Produces (internal in `MandateVault`, used further by Tasks 4 and 5):
  - `_checkCredit(Intent calldata) returns (Reason)`: credit disabled ⇒ `ACTION_NOT_SUPPORTED`; REPAY; SUPPLY; otherwise ⇒ `ACTION_NOT_SUPPORTED` (replaced in Task 4).
  - `_checkCollateralMove(ICreditAdapter ca, Intent calldata, bool isSupply) returns (Reason)`: allowlist (SUPPLY needs `allowed`, WITHDRAW needs `_listed`) → `supportsToken` → pause → policy → balance.
  - `_creditPathAuthorized(ICreditAdapter, address token, bool isSupply) returns (bool readable, bool authorized)`.
  - `_supplied(ICreditAdapter, address token) returns (bool ok, uint256 amount)`.
  - `_isCredit(Action) returns (bool)`, `_performCredit(Intent calldata) returns (Reason)`.
  - Behavior: credit does not add to `spentOnDay`; after every credit action `recordedUsdc = balanceOf(vault)`.

- [ ] **Step 1: Write the tests (fail)**

Add at the end of `contract MandateVaultCreditTest` in `test/MandateVaultCredit.t.sol`:

```solidity
    // ------------------------------------------------------------------ SUPPLY / REPAY (Task 3)

    function test_supplyMovesCollateralToAdapter() public {
        _supplyAll();
        assertEq(nvda.balanceOf(address(vault)), 0);
        assertEq(nvda.balanceOf(address(credit)), 1e8);
        assertEq(credit.suppliedOf(address(nvda)), 1e8);
        assertEq(nvda.allowance(address(vault), address(credit)), 0);
        assertEq(vault.spentOnDay(vault.today()), 0);
    }

    function test_supplyIsAllowedWhileMarketClosed() public {
        vm.warp(SAT_1300_ET);
        _assertReason(_execCredit(Action.SUPPLY, address(nvda), 1e8), Reason.OK);
    }

    function test_supplyRefusals() public {
        _assertReason(_execCredit(Action.SUPPLY, address(usdc), 1e6), Reason.TOKEN_NOT_ALLOWED);
        _assertReason(_execCredit(Action.SUPPLY, address(nvda), 0), Reason.INSUFFICIENT_BALANCE);
        _assertReason(_execCredit(Action.SUPPLY, address(nvda), 1e8 + 1), Reason.INSUFFICIENT_BALANCE);
        credit.setSupported(address(nvda), false);
        _assertReason(_execCredit(Action.SUPPLY, address(nvda), 1e8), Reason.TOKEN_NOT_ALLOWED);
    }

    function test_supplyOfPausedTokenIsRefused() public {
        nvda.setPaused(B20Constants.FEATURE_TRANSFER, true);
        _assertReason(_execCredit(Action.SUPPLY, address(nvda), 1e8), Reason.TOKEN_PAUSED);
    }

    function test_supplyChecksCustodianPolicy() public {
        address hub = makeAddr("hub");
        credit.setCustodian(hub);
        nvda.setPolicyId(B20Constants.TRANSFER_RECEIVER_POLICY, 9);
        registry.setAuthorized(9, address(credit), true); // the adapter may receive, the hub may not
        _assertReason(_execCredit(Action.SUPPLY, address(nvda), 1e8), Reason.POLICY_BLOCKED);
        registry.setAuthorized(9, hub, true);
        _assertReason(_execCredit(Action.SUPPLY, address(nvda), 1e8), Reason.OK);
    }

    function test_supplyAdapterFailureIsLogged() public {
        credit.setMutationsRevert(true, "");
        _assertReason(_execCredit(Action.SUPPLY, address(nvda), 1e8), Reason.CREDIT_FAILED);
        assertEq(nvda.balanceOf(address(vault)), 1e8);
        assertEq(nvda.allowance(address(vault), address(credit)), 0);
    }

    function test_unreadableAdapterIsCreditFailed() public {
        credit.setViewsRevert(true);
        _assertReason(_execCredit(Action.SUPPLY, address(nvda), 1e8), Reason.CREDIT_FAILED);
    }

    function test_repayPullsOnlyTheDebt() public {
        credit.setDebt(5e6);
        _assertReason(_execCredit(Action.REPAY, address(usdc), 10e6), Reason.OK);
        assertEq(usdc.balanceOf(address(vault)), 195e6);
        assertEq(credit.debt(), 0);
        assertEq(usdc.allowance(address(vault), address(credit)), 0);
        assertEq(vault.spentOnDay(vault.today()), 0);
        assertEq(vault.notifyRevenue(), 0);
    }

    function test_repayIsAllowedWhileMarketClosed() public {
        credit.setDebt(5e6);
        vm.warp(SAT_1300_ET);
        _assertReason(_execCredit(Action.REPAY, address(usdc), 5e6), Reason.OK);
        assertEq(credit.debt(), 0);
    }

    function test_repayRefusals() public {
        credit.setDebt(5e6);
        _assertReason(_execCredit(Action.REPAY, address(nvda), 5e6), Reason.TOKEN_NOT_ALLOWED);
        _assertReason(_execCredit(Action.REPAY, address(usdc), 0), Reason.INSUFFICIENT_BALANCE);
        _assertReason(_execCredit(Action.REPAY, address(usdc), 200e6 + 1), Reason.INSUFFICIENT_BALANCE);
        vm.prank(owner);
        vault.setPaused(true);
        _assertReason(_execCredit(Action.REPAY, address(usdc), 5e6), Reason.VAULT_PAUSED);
    }

    function test_concentrationCountsSuppliedCollateral() public {
        _supplyAll();
        // $200 supplied NVDAc + $20 buy over $400 total = 55% > 40%. Ignoring collateral it would be 10%.
        (, Reason r) = _exec(_intent(Action.BUY, 20e6));
        _assertReason(r, Reason.CONCENTRATION);
        credit.setSupplied(address(nvda), 0); // control: without the collateral the same buy passes
        adapter.setNextOut(0.1e8);
        (, r) = _exec(_intent(Action.BUY, 20e6));
        _assertReason(r, Reason.OK);
    }

    function test_unreadableCollateralFailsConcentrationClosed() public {
        _supplyAll();
        credit.setSupplied(address(nvda), 0);
        credit.setViewsRevert(true);
        (, Reason r) = _exec(_intent(Action.BUY, 20e6));
        _assertReason(r, Reason.CONCENTRATION);
    }
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `forge test --match-path test/MandateVaultCredit.t.sol`
Expected: FAIL. The SUPPLY/REPAY tests receive `ACTION_NOT_SUPPORTED` (2) instead of the expected reason; the tests that call `_supplyAll()` fail right at that step.

- [ ] **Step 3: Implement in `MandateVault.sol`**

In `_check`, replace the line:

```solidity
        if (intent.action != Action.BUY && intent.action != Action.SELL) return (Reason.ACTION_NOT_SUPPORTED, 0);
```

with:

```solidity
        if (intent.action != Action.BUY && intent.action != Action.SELL) return (_checkCredit(intent), 0);
```

Add the following functions after `_checkExpense`:

```solidity
    /// @dev Spec §3.1: SUPPLY (adding collateral) and REPAY reduce risk, so only checks 1-3 apply and they are
    /// allowed while the market is closed. Credit actions are not capped by perTradeCapUsd / dailyCapUsd.
    function _checkCredit(Intent calldata intent) internal view returns (Reason) {
        ICreditAdapter ca = ICreditAdapter(_mandate.creditAdapter);
        if (address(ca) == address(0)) return Reason.ACTION_NOT_SUPPORTED;
        Action a = intent.action;
        if (a == Action.REPAY) {
            if (intent.token != usdc) return Reason.TOKEN_NOT_ALLOWED;
            if (intent.amount == 0 || intent.amount > IERC20Minimal(usdc).balanceOf(address(this))) {
                return Reason.INSUFFICIENT_BALANCE;
            }
            return Reason.OK;
        }
        if (a == Action.SUPPLY) return _checkCollateralMove(ca, intent, true);
        return Reason.ACTION_NOT_SUPPORTED; // BORROW and WITHDRAW_COLLATERAL: Task 4
    }

    /// @dev SUPPLY needs an allowed token; WITHDRAW_COLLATERAL only a listed one, so collateral can always
    /// come home after a delisting.
    function _checkCollateralMove(ICreditAdapter ca, Intent calldata intent, bool isSupply)
        internal
        view
        returns (Reason)
    {
        address token = intent.token;
        if (isSupply ? !tokenConfig[token].allowed : !_listed[token]) return Reason.TOKEN_NOT_ALLOWED;
        try ca.supportsToken(token) returns (bool s) {
            if (!s) return Reason.TOKEN_NOT_ALLOWED;
        } catch {
            return Reason.CREDIT_FAILED;
        }
        if (GuardLib.tokenPaused(token)) return Reason.TOKEN_PAUSED;
        (bool readable, bool authorized) = _creditPathAuthorized(ca, token, isSupply);
        if (!readable) return Reason.CREDIT_FAILED;
        if (!authorized) return Reason.POLICY_BLOCKED;
        if (isSupply) {
            if (intent.amount == 0 || intent.amount > IB20Asset(token).balanceOf(address(this))) {
                return Reason.INSUFFICIENT_BALANCE;
            }
            return Reason.OK;
        }
        return Reason.ACTION_NOT_SUPPORTED; // WITHDRAW_COLLATERAL: Task 4
    }

    /// @dev SUPPLY: vault -> adapter -> custodian, pulled by the adapter, then by the operator.
    /// WITHDRAW_COLLATERAL: custodian -> adapter -> vault, sent by the custodian, then by the adapter.
    /// @return readable false when the adapter's custodian/operator views revert.
    function _creditPathAuthorized(ICreditAdapter ca, address token, bool isSupply)
        internal
        view
        returns (bool readable, bool authorized)
    {
        address custodian;
        address operator;
        try ca.collateralCustodian(token) returns (address c) {
            custodian = c;
        } catch {
            return (false, false);
        }
        try ca.collateralOperator() returns (address o) {
            operator = o;
        } catch {
            return (false, false);
        }
        address self = address(this);
        address a = address(ca);
        authorized = isSupply
            ? GuardLib.transferable(token, policyRegistry, _pair(self, a), _pair(a, custodian), _pair(a, operator))
            : GuardLib.transferable(token, policyRegistry, _pair(custodian, a), _pair(a, self), _pair(custodian, a));
        readable = true;
    }

    function _supplied(ICreditAdapter ca, address token) internal view returns (bool ok, uint256 amount) {
        try ca.suppliedOf(token) returns (uint256 s) {
            return (true, s);
        } catch {
            return (false, 0);
        }
    }

    function _pair(address a, address b) internal pure returns (address[] memory r) {
        r = new address[](2);
        r[0] = a;
        r[1] = b;
    }
```

Replace `_weightAfterBuyBps` with:

```solidity
    /// @dev Weight counts tokens held by the vault plus collateral supplied through the credit adapter (gross:
    /// debt is not netted). Fail-closed: unreadable collateral returns a weight above any cap (CONCENTRATION).
    function _weightAfterBuyBps(address token, uint256 usdIn, uint256 price8) internal view returns (uint256) {
        uint256 total = IERC20Minimal(usdc).balanceOf(address(this));
        uint256 tokenValue;
        ICreditAdapter ca = ICreditAdapter(_mandate.creditAdapter);
        for (uint256 i; i < _tokens.length; ++i) {
            address t = _tokens[i];
            uint256 bal = IB20Asset(t).balanceOf(address(this));
            if (address(ca) != address(0)) {
                (bool ok, uint256 supplied) = _supplied(ca, t);
                if (!ok) return type(uint256).max;
                bal += supplied;
            }
            if (bal == 0) continue;
            uint256 p = t == token ? price8 : _latestPrice(t);
            uint256 v = _valueUsd(t, bal, p);
            total += v;
            if (t == token) tokenValue = v;
        }
        if (total == 0) return BPS;
        return (tokenValue + usdIn) * BPS / total;
    }
```

In `_perform`, right after the line `notifyRevenue();` add:

```solidity
        if (_isCredit(intent.action)) return _performCredit(intent);
```

Add after `_perform`:

```solidity
    function _isCredit(Action a) internal pure returns (bool) {
        return a == Action.SUPPLY || a == Action.WITHDRAW_COLLATERAL || a == Action.BORROW || a == Action.REPAY;
    }

    /// @dev Credit actions are neither trades nor expenses: spentOnDay is untouched, and recordedUsdc is reset so
    /// borrowed USDC is never reported as revenue (nor repaid USDC as a loss). Adapter calls omit `returns` so
    /// malformed return data cannot revert execute().
    function _performCredit(Intent calldata intent) internal returns (Reason reason) {
        ICreditAdapter ca = ICreditAdapter(_mandate.creditAdapter);
        Action a = intent.action;
        if (a == Action.SUPPLY || a == Action.REPAY) {
            address token = a == Action.SUPPLY ? intent.token : usdc;
            if (!token.tryApprove(address(ca), intent.amount)) {
                token.tryApprove(address(ca), 0);
                return Reason.TRANSFER_FAILED;
            }
            if (a == Action.SUPPLY) {
                try ca.supply(token, intent.amount) {}
                catch {
                    reason = Reason.CREDIT_FAILED;
                }
            } else {
                try ca.repay(intent.amount) {}
                catch {
                    reason = Reason.CREDIT_FAILED;
                }
            }
            token.tryApprove(address(ca), 0);
        } else {
            reason = Reason.ACTION_NOT_SUPPORTED; // BORROW / WITHDRAW_COLLATERAL: Task 4
        }
        recordedUsdc = IERC20Minimal(usdc).balanceOf(address(this));
    }
```

Update the natspec of `previewIntent`:

```solidity
    /// @notice Same verdict execute() would reach before acting. Cannot predict SWAP_FAILED / TRANSFER_FAILED /
    /// CREDIT_FAILED, nor the adapter's own post-action health check on WITHDRAW_COLLATERAL against debt.
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `forge test --match-path test/MandateVaultCredit.t.sol -vv`
Expected: PASS (11 Task 1 tests + 12 Task 3 tests).

Run: `forge test --no-match-path "test/fork/*"`
Expected: all PASS.

- [ ] **Step 5: Check the size**

Run: `forge build --sizes 2>&1 | grep MandateVault`
Expected: `MandateVault` runtime size < 24,576. Record the number in the report. If it is exceeded, follow Global Constraints.

- [ ] **Step 6: Commit**

```bash
git add src/MandateVault.sol test/MandateVaultCredit.t.sol
git commit -m "feat: let the vault supply collateral and repay debt through the credit adapter

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Vault BORROW / WITHDRAW_COLLATERAL, health factor and derisk window

**Files:**
- Modify: `contracts/src/MandateVault.sol`
- Modify: `contracts/test/MandateVaultCredit.t.sol`

**Interfaces:**
- Consumes: Task 2 `GuardLib.marketOpen`, `GuardLib.collateralHealthy`, `GuardLib.CollateralCheck`; Task 3 `_checkCredit`, `_checkCollateralMove`, `_supplied`, `_performCredit`; `MarketCalendar.localTime(uint256) returns (uint256 etDay, uint256 weekday, uint256 minuteOfDay)` (weekday 0 = Sunday, 5 = Friday).
- Produces:
  - `_checkBorrow(ICreditAdapter, uint256) returns (Reason)`, `_checkCollateralMarket(ICreditAdapter) returns (Reason)`.
  - `_healthReason(uint256 hf) returns (Reason)`: `hf < minHealthFactor` ⇒ `HEALTH_FACTOR_LOW`; inside the window and `hf < targetHealthFactor` ⇒ `DERISK_WINDOW`; otherwise `OK`.
  - `_inDeriskWindow() returns (bool)`, `_requiredHealthFactor() returns (uint256)`, `_creditFailure(bytes memory) returns (Reason)`.
  - The vault passes `minHealthFactor` = `targetHealthFactor` inside the window and `minHealthFactor` outside the window, into the adapter's `borrow` / `withdraw`.

- [ ] **Step 1: Write the tests (fail)**

Add at the end of `contract MandateVaultCreditTest`:

```solidity
    // ------------------------------------------------------------------ BORROW / WITHDRAW (Task 4)

    function test_borrowSendsUsdcToVault() public {
        _supplyAll();
        credit.setProjectedHf(2.5e18);
        _assertReason(_execCredit(Action.BORROW, address(usdc), 5e6), Reason.OK);
        assertEq(usdc.balanceOf(address(vault)), 205e6);
        assertEq(credit.debt(), 5e6);
        assertEq(credit.lastMinHf(), MIN_HF); // Thu 10:30 ET is outside the derisk window
        assertEq(vault.spentOnDay(vault.today()), 0);
    }

    function test_borrowedUsdcIsNotRevenue() public {
        _supplyAll();
        _assertReason(_execCredit(Action.BORROW, address(usdc), 5e6), Reason.OK);
        assertEq(vault.notifyRevenue(), 0);
        assertEq(vault.recordedUsdc(), 205e6);
        usdc.mint(address(vault), 1e6); // revenue arriving afterwards is still counted
        assertEq(vault.notifyRevenue(), 1e6);
    }

    function test_borrowRefusals() public {
        _supplyAll();
        _assertReason(_execCredit(Action.BORROW, address(nvda), 5e6), Reason.TOKEN_NOT_ALLOWED);
        _assertReason(_execCredit(Action.BORROW, address(usdc), 0), Reason.INSUFFICIENT_BALANCE);
        credit.setProjectedHf(MIN_HF - 1);
        _assertReason(_execCredit(Action.BORROW, address(usdc), 5e6), Reason.HEALTH_FACTOR_LOW);
        credit.setProjectedHf(MIN_HF);
        _assertReason(_execCredit(Action.BORROW, address(usdc), 5e6), Reason.OK);
    }

    function test_borrowRefusedWhileMarketClosedButRepayAllowed() public {
        _supplyAll();
        _assertReason(_execCredit(Action.BORROW, address(usdc), 5e6), Reason.OK);
        _warpFresh(SAT_1300_ET);
        _assertReason(_execCredit(Action.BORROW, address(usdc), 5e6), Reason.MARKET_CLOSED);
        _assertReason(_execCredit(Action.REPAY, address(usdc), 5e6), Reason.OK);
        assertEq(credit.debt(), 0);
    }

    function test_staleCollateralFeedBlocksBorrowNotRepay() public {
        _supplyAll();
        credit.setDebt(5e6);
        feed.set(200e8, THU_1030_ET - 3601); // calendar says open, but the feed has stopped
        _assertReason(_execCredit(Action.BORROW, address(usdc), 1e6), Reason.FEED_STALE);
        _assertReason(_execCredit(Action.REPAY, address(usdc), 5e6), Reason.OK);
        nvda.mint(address(vault), 1e8);
        _assertReason(_execCredit(Action.SUPPLY, address(nvda), 1e8), Reason.OK);
    }

    function test_collateralMultiplierChangeBlocksBorrow() public {
        _supplyAll();
        nvda.setUiMultiplier(2e18);
        _assertReason(_execCredit(Action.BORROW, address(usdc), 1e6), Reason.MULTIPLIER_COOLDOWN);
    }

    function test_pausedCollateralBlocksBorrow() public {
        _supplyAll();
        nvda.setPaused(B20Constants.FEATURE_TRANSFER, true);
        _assertReason(_execCredit(Action.BORROW, address(usdc), 1e6), Reason.TOKEN_PAUSED);
    }

    function test_unreadableProjectionIsCreditFailed() public {
        _supplyAll();
        credit.setViewsRevert(true);
        _assertReason(_execCredit(Action.BORROW, address(usdc), 1e6), Reason.CREDIT_FAILED);
    }

    function test_deriskWindowRequiresTargetHealthFactor() public {
        _supplyAll();
        credit.setProjectedHf(1.8e18); // above min (1.5), below target (2.0)
        _warpFresh(FRI_1300_ET); // 13:00 + 6h < 20:00: outside
        _assertReason(_execCredit(Action.BORROW, address(usdc), 1e6), Reason.OK);
        assertEq(credit.lastMinHf(), MIN_HF);
        _warpFresh(FRI_1400_ET); // 14:00 + 6h = 20:00: inside
        _assertReason(_execCredit(Action.BORROW, address(usdc), 1e6), Reason.DERISK_WINDOW);
        _warpFresh(FRI_1500_ET);
        _assertReason(_execCredit(Action.BORROW, address(usdc), 1e6), Reason.DERISK_WINDOW);
        credit.setProjectedHf(TARGET_HF);
        _assertReason(_execCredit(Action.BORROW, address(usdc), 1e6), Reason.OK);
        assertEq(credit.lastMinHf(), TARGET_HF);
    }

    function test_deriskWindowDisabledWhenZero() public {
        Mandate memory m = creditMandate();
        m.deriskWindow = 0;
        (vault, credit) = _deployCreditVault(m);
        nvda.mint(address(vault), 1e8);
        _supplyAll();
        credit.setProjectedHf(1.8e18);
        _warpFresh(FRI_1500_ET);
        _assertReason(_execCredit(Action.BORROW, address(usdc), 1e6), Reason.OK);
    }

    function test_adapterHealthCheckIsMappedToReasons() public {
        _supplyAll();
        credit.setNextHf(1.2e18); // the projection said fine, the venue disagrees after the fact
        _assertReason(_execCredit(Action.BORROW, address(usdc), 1e6), Reason.HEALTH_FACTOR_LOW);
        assertEq(credit.debt(), 0);
        _warpFresh(FRI_1500_ET);
        credit.setNextHf(1.8e18);
        _assertReason(_execCredit(Action.BORROW, address(usdc), 1e6), Reason.DERISK_WINDOW);
        assertEq(usdc.balanceOf(address(vault)), 200e6);
    }

    function test_adapterRevertNeverRevertsExecute() public {
        _supplyAll();
        bytes[3] memory errs = [
            bytes(""),
            abi.encodeWithSignature("Panic(uint256)", uint256(0x11)),
            abi.encodeWithSelector(ICreditAdapter.HealthFactorTooLow.selector, uint256(1)) // wrong length
        ];
        for (uint256 k; k < errs.length; ++k) {
            credit.setMutationsRevert(true, errs[k]);
            _assertReason(_execCredit(Action.BORROW, address(usdc), 1e6), Reason.CREDIT_FAILED);
            _assertReason(_execCredit(Action.WITHDRAW_COLLATERAL, address(nvda), 1e8), Reason.CREDIT_FAILED);
        }
        assertEq(credit.debt(), 0);
        assertEq(credit.suppliedOf(address(nvda)), 1e8);
        assertEq(usdc.balanceOf(address(vault)), 200e6);
    }

    function test_withdrawWithoutDebtIsAllowedWhileMarketClosed() public {
        _supplyAll();
        vm.warp(SAT_1300_ET);
        _assertReason(_execCredit(Action.WITHDRAW_COLLATERAL, address(nvda), 1e8), Reason.OK);
        assertEq(nvda.balanceOf(address(vault)), 1e8);
        assertEq(credit.lastMinHf(), MIN_HF);
    }

    function test_withdrawAgainstDebtNeedsOpenMarket() public {
        _supplyAll();
        credit.setDebt(5e6);
        vm.warp(SAT_1300_ET);
        _assertReason(_execCredit(Action.WITHDRAW_COLLATERAL, address(nvda), 0.5e8), Reason.MARKET_CLOSED);
    }

    function test_withdrawRefusals() public {
        _supplyAll();
        _assertReason(_execCredit(Action.WITHDRAW_COLLATERAL, address(nvda), 1e8 + 1), Reason.INSUFFICIENT_BALANCE);
        _assertReason(_execCredit(Action.WITHDRAW_COLLATERAL, address(nvda), 0), Reason.INSUFFICIENT_BALANCE);
        _assertReason(_execCredit(Action.WITHDRAW_COLLATERAL, address(usdc), 1e6), Reason.TOKEN_NOT_ALLOWED);
        credit.setDebt(5e6);
        credit.setNextHf(1.4e18);
        _assertReason(_execCredit(Action.WITHDRAW_COLLATERAL, address(nvda), 0.5e8), Reason.HEALTH_FACTOR_LOW);
        assertEq(credit.suppliedOf(address(nvda)), 1e8);
    }

    function test_withdrawChecksCustodianPolicy() public {
        _supplyAll();
        address hub = makeAddr("hub");
        credit.setCustodian(hub);
        nvda.setPolicyId(B20Constants.TRANSFER_SENDER_POLICY, 9);
        registry.setAuthorized(9, address(credit), true); // the adapter may send, the hub may not
        _assertReason(_execCredit(Action.WITHDRAW_COLLATERAL, address(nvda), 1e8), Reason.POLICY_BLOCKED);
    }

    function test_previewMatchesExecuteForBorrow() public {
        _supplyAll();
        credit.setProjectedHf(1.4e18);
        Intent memory i = _creditIntent(Action.BORROW, address(usdc), 5e6);
        _assertReason(vault.previewIntent(i), Reason.HEALTH_FACTOR_LOW);
        (, Reason r) = _exec(i);
        _assertReason(r, Reason.HEALTH_FACTOR_LOW);
    }
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `forge test --match-path test/MandateVaultCredit.t.sol`
Expected: FAIL. The BORROW / WITHDRAW tests receive `ACTION_NOT_SUPPORTED` (2).

- [ ] **Step 3: Implement in `MandateVault.sol`**

Add the import:

```solidity
import {MarketCalendar} from "./MarketCalendar.sol";
```

Add the constant below `MAX_DERISK_WINDOW`:

```solidity
    uint256 internal constant FRIDAY = 5; // DateLib.weekday: 0 = Sunday
    uint256 internal constant FEED_FREEZE_MINUTE = 20 * 60; // Fri 20:00 ET: Chainlink equity feeds stop
```

In `_checkCredit`, replace the last line `return Reason.ACTION_NOT_SUPPORTED; // BORROW and WITHDRAW_COLLATERAL: Task 4` with:

```solidity
        if (a == Action.BORROW) {
            if (intent.token != usdc) return Reason.TOKEN_NOT_ALLOWED;
            if (intent.amount == 0) return Reason.INSUFFICIENT_BALANCE;
            return _checkBorrow(ca, intent.amount);
        }
        return _checkCollateralMove(ca, intent, false);
```

In `_checkCollateralMove`, replace the last line `return Reason.ACTION_NOT_SUPPORTED; // WITHDRAW_COLLATERAL: Task 4` with:

```solidity
        (bool ok, uint256 supplied) = _supplied(ca, token);
        if (!ok) return Reason.CREDIT_FAILED;
        if (intent.amount == 0 || intent.amount > supplied) return Reason.INSUFFICIENT_BALANCE;
        // Without debt, withdrawing collateral is risk-free and allowed at any hour.
        try ca.debt() returns (uint256 d) {
            if (d == 0) return Reason.OK;
        } catch {
            return Reason.CREDIT_FAILED;
        }
        // Against debt it adds risk: checks 4-6 here, the health factor in the adapter after the withdrawal.
        return _checkCollateralMarket(ca);
```

Add after `_checkCollateralMove`:

```solidity
    /// @dev Spec §3.1: borrowing adds risk, so checks 4-6 apply to every supplied collateral, then the projected
    /// health factor must clear minHealthFactor (targetHealthFactor inside the Friday derisk window).
    function _checkBorrow(ICreditAdapter ca, uint256 amount) internal view returns (Reason) {
        Reason r = _checkCollateralMarket(ca);
        if (r != Reason.OK) return r;
        try ca.projectedHealthFactorAfterBorrow(amount) returns (uint256 hf) {
            return _healthReason(hf);
        } catch {
            return Reason.CREDIT_FAILED;
        }
    }

    /// @dev Market open (check 4), then for each supplied collateral: not paused, live feed, no multiplier change.
    function _checkCollateralMarket(ICreditAdapter ca) internal view returns (Reason) {
        Mandate memory m = _mandate;
        if (!GuardLib.marketOpen(m.calendar, m.sessionMode)) return Reason.MARKET_CLOSED;
        for (uint256 i; i < _tokens.length; ++i) {
            address t = _tokens[i];
            (bool ok, uint256 supplied) = _supplied(ca, t);
            if (!ok) return Reason.CREDIT_FAILED;
            if (supplied == 0) continue;
            Reason r = GuardLib.collateralHealthy(
                GuardLib.CollateralCheck({
                    token: t,
                    feed: tokenConfig[t].feed,
                    maxStaleness: m.maxStaleness,
                    multiplierCooldown: m.multiplierCooldown,
                    lastMultiplier: lastMultiplier[t],
                    multiplierChangedAt: multiplierChangedAt[t]
                })
            );
            if (r != Reason.OK) return r;
        }
        return Reason.OK;
    }

    function _healthReason(uint256 hf) internal view returns (Reason) {
        if (hf < _mandate.minHealthFactor) return Reason.HEALTH_FACTOR_LOW;
        if (hf < _mandate.targetHealthFactor && _inDeriskWindow()) return Reason.DERISK_WINDOW;
        return Reason.OK;
    }

    function _requiredHealthFactor() internal view returns (uint256) {
        return _inDeriskWindow() ? _mandate.targetHealthFactor : _mandate.minHealthFactor;
    }

    /// @dev The last `deriskWindow` seconds before Fri 20:00 ET, when Chainlink equity feeds stop and prices
    /// freeze for the weekend. Fail-closed: an unreadable calendar counts as inside the window.
    function _inDeriskWindow() internal view returns (bool) {
        uint256 w = _mandate.deriskWindow;
        if (w == 0) return false;
        try MarketCalendar(_mandate.calendar).localTime(block.timestamp) returns (uint256, uint256 wd, uint256 minute) {
            return wd == FRIDAY && minute < FEED_FREEZE_MINUTE && minute + w / 60 >= FEED_FREEZE_MINUTE;
        } catch {
            return true;
        }
    }

    /// @dev Maps an adapter revert to a Reason. Only a well-formed HealthFactorTooLow(hf, min) becomes a health
    /// reason; anything else (empty data, Panic, venue errors) is CREDIT_FAILED.
    function _creditFailure(bytes memory err) internal view returns (Reason) {
        if (err.length == 68 && bytes4(err) == ICreditAdapter.HealthFactorTooLow.selector) {
            uint256 hf;
            assembly ("memory-safe") {
                hf := mload(add(err, 36))
            }
            Reason r = _healthReason(hf);
            return r == Reason.OK ? Reason.CREDIT_FAILED : r;
        }
        return Reason.CREDIT_FAILED;
    }
```

In `_performCredit`, replace the block:

```solidity
        } else {
            reason = Reason.ACTION_NOT_SUPPORTED; // BORROW / WITHDRAW_COLLATERAL: Task 4
        }
```

with:

```solidity
        } else {
            uint256 minHf = _requiredHealthFactor();
            if (a == Action.BORROW) {
                try ca.borrow(intent.amount, minHf) {}
                catch (bytes memory err) {
                    reason = _creditFailure(err);
                }
            } else {
                try ca.withdraw(intent.token, intent.amount, minHf) {}
                catch (bytes memory err) {
                    reason = _creditFailure(err);
                }
            }
        }
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `forge test --match-path test/MandateVaultCredit.t.sol -vv`
Expected: PASS (23 old tests + 17 Task 4 tests).

Run: `forge test --no-match-path "test/fork/*"`
Expected: all PASS.

- [ ] **Step 5: Check the size**

Run: `forge build --sizes 2>&1 | grep MandateVault`
Expected: runtime < 24,576. Record the number in the report; if it is exceeded, follow Global Constraints.

- [ ] **Step 6: Commit**

```bash
git add src/MandateVault.sol test/MandateVaultCredit.t.sol
git commit -m "feat: gate borrowing and collateral withdrawal on market, collateral health and HF

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Token exit-only

**Files:**
- Modify: `contracts/src/MandateVault.sol` (`execute`, `syncMultiplier`, `_check`, `_setToken`, add `_hasMarket`)
- Modify: `contracts/test/MandateVault.t.sol`
- Modify: `contracts/test/MandateVaultCredit.t.sol`

**Interfaces:**
- Consumes: Plan 1 `_setToken`, `_requireValidTokenConfig`, `_syncMultiplier`; Task 3/4 `_checkCollateralMove` (WITHDRAW needs `_listed`), `_checkCollateralMarket` (feed `address(0)` ⇒ `BAD_PRICE` via `GuardLib.collateralHealthy`).
- Produces: `_hasMarket(TokenConfig memory) returns (bool)` = `allowed || feed != 0 || pool != 0`. A token with a market is validated and has its multiplier tracked. BUY and SUPPLY need `allowed`; SELL needs `_hasMarket`; WITHDRAW_COLLATERAL needs `_listed`. Every listed token must have code.

- [ ] **Step 1: Write the tests (fail)**

Add at the end of `contract MandateVaultTest` in `test/MandateVault.t.sol`:

```solidity
    // ------------------------------------------------------------------ exit-only tokens (Plan 2A)

    function _applyNvdaConfig(TokenConfig memory c) internal {
        _queueTokenAndWait(address(nvda), c);
        vm.prank(owner);
        vault.applyTokenConfig(address(nvda), c);
        feed.set(200e8, vm.getBlockTimestamp()); // the 24h wait left the feed stale
    }

    function test_exitOnlyTokenCanBeSoldNotBought() public {
        nvda.mint(address(vault), 1e8);
        _applyNvdaConfig(TokenConfig({allowed: false, feed: address(feed), pool: address(pool), maxWeightBps: 0}));
        (, Reason buy) = _exec(_intent(Action.BUY, 20e6));
        _assertReason(buy, Reason.TOKEN_NOT_ALLOWED);
        adapter.setNextOut(20e6);
        (, Reason sell) = _exec(_intent(Action.SELL, 0.1e8));
        _assertReason(sell, Reason.OK);
        assertEq(nvda.balanceOf(address(vault)), 0.9e8);
    }

    function test_exitOnlyTokenIsStillMultiplierGuarded() public {
        nvda.mint(address(vault), 1e8);
        _applyNvdaConfig(TokenConfig({allowed: false, feed: address(feed), pool: address(pool), maxWeightBps: 0}));
        nvda.setUiMultiplier(2e18);
        (, Reason r) = _exec(_intent(Action.SELL, 0.1e8));
        _assertReason(r, Reason.MULTIPLIER_COOLDOWN);
        assertEq(vault.lastMultiplier(address(nvda)), 2e18); // execute() kept tracking it
    }

    function test_exitOnlyConfigIsValidated() public {
        TokenConfig memory c =
            TokenConfig({allowed: false, feed: makeAddr("noCodeFeed"), pool: address(pool), maxWeightBps: 0});
        _queueTokenAndWait(address(nvda), c);
        vm.prank(owner);
        vm.expectRevert(MandateVault.InvalidConfig.selector);
        vault.applyTokenConfig(address(nvda), c);
    }

    function test_fullyDelistedTokenCannotBeSold() public {
        nvda.mint(address(vault), 1e8);
        _applyNvdaConfig(TokenConfig({allowed: false, feed: address(0), pool: address(0), maxWeightBps: 0}));
        (, Reason r) = _exec(_intent(Action.SELL, 0.1e8));
        _assertReason(r, Reason.TOKEN_NOT_ALLOWED);
    }

    function test_rejectsListingAnAddressWithoutCode() public {
        TokenConfig memory c = TokenConfig({allowed: false, feed: address(0), pool: address(0), maxWeightBps: 0});
        address ghost = makeAddr("ghost");
        _queueTokenAndWait(ghost, c);
        vm.prank(owner);
        vm.expectRevert(MandateVault.InvalidConfig.selector);
        vault.applyTokenConfig(ghost, c);
    }
```

Add at the end of `contract MandateVaultCreditTest`:

```solidity
    // ------------------------------------------------------------------ exit-only collateral (Task 5)

    function _applyNvdaConfig(TokenConfig memory c) internal {
        _queueTokenAndWait(address(nvda), c);
        vm.prank(owner);
        vault.applyTokenConfig(address(nvda), c);
        feed.set(200e8, vm.getBlockTimestamp()); // the 24h wait left the feed stale
    }

    function test_exitOnlyCollateralCanBeWithdrawnNotSupplied() public {
        _assertReason(_execCredit(Action.SUPPLY, address(nvda), 0.5e8), Reason.OK);
        _applyNvdaConfig(TokenConfig({allowed: false, feed: address(feed), pool: address(pool), maxWeightBps: 0}));
        _assertReason(_execCredit(Action.SUPPLY, address(nvda), 0.5e8), Reason.TOKEN_NOT_ALLOWED);
        _assertReason(_execCredit(Action.WITHDRAW_COLLATERAL, address(nvda), 0.5e8), Reason.OK);
        assertEq(nvda.balanceOf(address(vault)), 1e8);
    }

    function test_fullyDelistedCollateralComesHomeWithoutDebt() public {
        _supplyAll();
        _applyNvdaConfig(TokenConfig({allowed: false, feed: address(0), pool: address(0), maxWeightBps: 0}));
        _assertReason(_execCredit(Action.WITHDRAW_COLLATERAL, address(nvda), 1e8), Reason.OK);
        assertEq(nvda.balanceOf(address(vault)), 1e8);
    }

    function test_fullyDelistedCollateralBlocksBorrowing() public {
        _supplyAll();
        credit.setDebt(1e6);
        _applyNvdaConfig(TokenConfig({allowed: false, feed: address(0), pool: address(0), maxWeightBps: 0}));
        _assertReason(_execCredit(Action.BORROW, address(usdc), 1e6), Reason.BAD_PRICE);
        _assertReason(_execCredit(Action.REPAY, address(usdc), 1e6), Reason.OK);
    }
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `forge test --match-path "test/MandateVault*.t.sol"`
Expected: FAIL at `test_exitOnlyTokenCanBeSoldNotBought` (SELL receives `TOKEN_NOT_ALLOWED`), `test_exitOnlyTokenIsStillMultiplierGuarded`, `test_exitOnlyConfigIsValidated` and `test_rejectsListingAnAddressWithoutCode` (no revert). The remaining exit-only tests may already pass thanks to Tasks 3/4.

- [ ] **Step 3: Implement in `MandateVault.sol`**

Add after `_isCredit`:

```solidity
    /// @dev A token with a feed or pool configured has a market: it is validated like an allowed token and its
    /// multiplier is tracked. allowed=false with a market is exit-only: SELL keeps working, BUY and SUPPLY are
    /// refused. Clearing both feed and pool removes the market (no SELL; collateral can still be withdrawn).
    function _hasMarket(TokenConfig memory c) internal pure returns (bool) {
        return c.allowed || c.feed != address(0) || c.pool != address(0);
    }
```

In `execute`, replace:

```solidity
        if (tokenConfig[intent.token].allowed) _syncMultiplier(intent.token);
```

with:

```solidity
        if (_hasMarket(tokenConfig[intent.token])) _syncMultiplier(intent.token);
```

In `syncMultiplier`, replace `if (tokenConfig[token].allowed) _syncMultiplier(token);` with:

```solidity
        if (_hasMarket(tokenConfig[token])) _syncMultiplier(token);
```

In `_check`, replace:

```solidity
        TokenConfig memory cfg = tokenConfig[intent.token];
        if (!cfg.allowed) return (Reason.TOKEN_NOT_ALLOWED, 0);
        bool isBuy = intent.action == Action.BUY;
```

with:

```solidity
        TokenConfig memory cfg = tokenConfig[intent.token];
        bool isBuy = intent.action == Action.BUY;
        // SELL also works for exit-only tokens, so a delisting never traps a holding while a market exists
        if (isBuy ? !cfg.allowed : !_hasMarket(cfg)) return (Reason.TOKEN_NOT_ALLOWED, 0);
```

Replace `_setToken` with:

```solidity
    function _setToken(address token, TokenConfig memory c) internal {
        if (token == address(0)) revert ZeroAddress();
        // every listed token is read in execute() loops; a call to an address without code would revert it
        if (token.code.length == 0) revert InvalidConfig();
        bool market = _hasMarket(c);
        if (market) _requireValidTokenConfig(token, c);
        if (!_listed[token]) {
            _listed[token] = true;
            _tokens.push(token);
        }
        tokenConfig[token] = c;
        if (market) {
            uint256 cur = IB20Asset(token).uiMultiplier();
            // First snapshot (last == 0) starts no cooldown; re-applying must not silently absorb a later change.
            if (lastMultiplier[token] == 0) lastMultiplier[token] = cur;
            else _recordMultiplier(token, cur);
        }
        emit TokenConfigApplied(token, c);
    }
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `forge test --no-match-path "test/fork/*" -vv`
Expected: all PASS, including 5 new tests in `MandateVault.t.sol` and 3 new tests in `MandateVaultCredit.t.sol`. `test_disallowedTokenConfigSkipsFeedPoolValidation` (Plan 1) still passes because that config has neither a feed nor a pool.

- [ ] **Step 5: Check the size**

Run: `forge build --sizes 2>&1 | grep MandateVault`
Expected: runtime < 24,576. Record the number in the report; if it is exceeded, follow Global Constraints.

- [ ] **Step 6: Commit**

```bash
git add src/MandateVault.sol test/MandateVault.t.sol test/MandateVaultCredit.t.sol
git commit -m "feat: keep SELL and collateral withdrawal open for exit-only tokens

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: AaveV4CreditAdapter (unit tests with MockSpoke)

**Files:**
- Create: `contracts/src/interfaces/IAaveV4.sol`
- Create: `contracts/src/adapters/AaveV4CreditAdapter.sol`
- Create: `contracts/test/mocks/MockSpoke.sol`
- Create: `contracts/test/AaveV4CreditAdapter.t.sol`

**Interfaces:**
- Consumes: Task 1 `ICreditAdapter` (errors `NotVault`, `UnsupportedToken`, `HealthFactorTooLow`); Plan 1 `TokenTransfer.safeTransfer/safeTransferFrom/safeApprove`.
- Produces:
  - `IAaveV4Spoke` (struct `Reserve`, struct `UserAccountData`, `supply/withdraw/borrow/repay/setUsingAsCollateral`, `getUserAccountData`, `getUserReserveStatus`, `getUserSuppliedAssets`, `getUserTotalDebt`, `getReserve`, `ORACLE`), `IAaveV4Oracle` (`decimals`, `getReservePrice`).
  - `AaveV4CreditAdapter(address vault_, address usdc_, address spoke_, uint256 usdcReserveId_, address[] memory tokens_, uint256[] memory reserveIds_)`, implements all of `ICreditAdapter`, adds the getters `spoke()`, `hub()`, `usdcReserveId()`, `collaterals()`, and the errors `ZeroAddress()`, `LengthMismatch()`, `ReserveMismatch(uint256 reserveId)`.
  - `custodian = hub` (holds the collateral, transfers it out itself on withdraw), `operator = spoke` (pulls tokens on supply).

- [ ] **Step 1: Create `src/interfaces/IAaveV4.sol`**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice Subset of the Aave V4 Spoke (ISpoke.sol, aave/aave-v4 main @ a3ef63ea) and its oracle used by Maat.
/// Selectors were checked against the MAG7 Spoke implementation on Base (research/03-aave-v4-equities-hub.md §3).
interface IAaveV4Spoke {
    struct Reserve {
        address underlying;
        address hub;
        uint16 assetId;
        uint8 decimals;
        uint24 collateralRisk;
        uint8 flags;
        uint32 dynamicConfigKey;
    }

    struct UserAccountData {
        uint256 riskPremium; // BPS
        uint256 avgCollateralFactor; // WAD
        uint256 healthFactor; // WAD; type(uint256).max with no debt
        uint256 totalCollateralValue; // value units: 1e26 = 1 USD
        uint256 totalDebtValueRay; // value units x 1e27
        uint256 activeCollateralCount;
        uint256 borrowCount;
    }

    function supply(uint256 reserveId, uint256 amount, address onBehalfOf) external returns (uint256, uint256);
    function withdraw(uint256 reserveId, uint256 amount, address onBehalfOf) external returns (uint256, uint256);
    function borrow(uint256 reserveId, uint256 amount, address onBehalfOf) external returns (uint256, uint256);
    function repay(uint256 reserveId, uint256 amount, address onBehalfOf) external returns (uint256, uint256);
    function setUsingAsCollateral(uint256 reserveId, bool usingAsCollateral, address onBehalfOf) external;

    function getUserAccountData(address user) external view returns (UserAccountData memory);
    /// @return usingAsCollateral, borrowing
    function getUserReserveStatus(uint256 reserveId, address user) external view returns (bool, bool);
    function getUserSuppliedAssets(uint256 reserveId, address user) external view returns (uint256);
    function getUserTotalDebt(uint256 reserveId, address user) external view returns (uint256);
    function getReserve(uint256 reserveId) external view returns (Reserve memory);
    function ORACLE() external view returns (address);
}

interface IAaveV4Oracle {
    function decimals() external view returns (uint8);
    function getReservePrice(uint256 reserveId) external view returns (uint256);
}
```

- [ ] **Step 2: Create `test/mocks/MockSpoke.sol`**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IAaveV4Spoke} from "../../src/interfaces/IAaveV4.sol";
import {IERC20Minimal} from "../../src/interfaces/IExternal.sol";

/// @notice Minimal Aave V4 spoke that is also its own oracle and (unless overridden per reserve) its own hub,
/// so it holds every token. Health factor uses Aave's units: value 1e26 = 1 USD, debt as value x RAY.
contract MockSpoke {
    uint256 internal constant RAY = 1e27;

    struct R {
        address underlying;
        address hub;
        uint8 decimals;
        uint256 price; // 8 decimals
        uint16 cfBps;
    }

    mapping(uint256 => R) public reserves;
    uint256[] internal _ids;
    uint256 public usdcReserveId;
    mapping(uint256 => mapping(address => uint256)) public supplied;
    mapping(uint256 => mapping(address => bool)) public usingAsCollateral;
    mapping(address => uint256) public owed;
    uint256 public setCollateralCalls;

    error HealthFactorBelowThreshold();

    function addReserve(uint256 id, address underlying, uint8 decimals_, uint256 price8, uint16 cfBps) external {
        reserves[id] = R(underlying, address(this), decimals_, price8, cfBps);
        _ids.push(id);
    }

    function setUsdcReserve(uint256 id) external {
        usdcReserveId = id;
    }

    function setHub(uint256 id, address hub_) external {
        reserves[id].hub = hub_;
    }

    function accrue(address user, uint256 interest) external {
        owed[user] += interest;
    }

    // ---------------------------------------------------------------- oracle

    function ORACLE() external view returns (address) {
        return address(this);
    }

    function decimals() external pure returns (uint8) {
        return 8;
    }

    function getReservePrice(uint256 id) external view returns (uint256) {
        return reserves[id].price;
    }

    // ---------------------------------------------------------------- spoke

    function getReserve(uint256 id) external view returns (IAaveV4Spoke.Reserve memory r) {
        r.underlying = reserves[id].underlying;
        r.hub = reserves[id].hub;
        r.assetId = uint16(id);
        r.decimals = reserves[id].decimals;
    }

    function supply(uint256 id, uint256 amount, address onBehalfOf) external returns (uint256, uint256) {
        IERC20Minimal(reserves[id].underlying).transferFrom(msg.sender, address(this), amount);
        supplied[id][onBehalfOf] += amount;
        return (amount, amount);
    }

    function setUsingAsCollateral(uint256 id, bool using_, address onBehalfOf) external {
        usingAsCollateral[id][onBehalfOf] = using_;
        ++setCollateralCalls;
    }

    function withdraw(uint256 id, uint256 amount, address onBehalfOf) external returns (uint256, uint256) {
        uint256 s = supplied[id][onBehalfOf];
        if (amount > s) amount = s;
        supplied[id][onBehalfOf] = s - amount;
        _requireSolvent(onBehalfOf);
        IERC20Minimal(reserves[id].underlying).transfer(msg.sender, amount);
        return (amount, amount);
    }

    function borrow(uint256 id, uint256 amount, address onBehalfOf) external returns (uint256, uint256) {
        owed[onBehalfOf] += amount;
        _requireSolvent(onBehalfOf);
        IERC20Minimal(reserves[id].underlying).transfer(msg.sender, amount);
        return (amount, amount);
    }

    function repay(uint256 id, uint256 amount, address onBehalfOf) external returns (uint256, uint256) {
        uint256 pull = amount < owed[onBehalfOf] ? amount : owed[onBehalfOf];
        IERC20Minimal(reserves[id].underlying).transferFrom(msg.sender, address(this), pull);
        owed[onBehalfOf] -= pull;
        return (pull, pull);
    }

    function getUserReserveStatus(uint256 id, address user) external view returns (bool, bool) {
        return (usingAsCollateral[id][user], id == usdcReserveId && owed[user] != 0);
    }

    function getUserSuppliedAssets(uint256 id, address user) external view returns (uint256) {
        return supplied[id][user];
    }

    function getUserTotalDebt(uint256 id, address user) external view returns (uint256) {
        return id == usdcReserveId ? owed[user] : 0;
    }

    function getUserAccountData(address user) public view returns (IAaveV4Spoke.UserAccountData memory d) {
        uint256 weighted;
        for (uint256 i; i < _ids.length; ++i) {
            uint256 id = _ids[i];
            if (id == usdcReserveId || !usingAsCollateral[id][user]) continue;
            R memory r = reserves[id];
            uint256 v = supplied[id][user] * r.price * 10 ** (26 - uint256(r.decimals) - 8);
            if (v == 0) continue;
            d.totalCollateralValue += v;
            weighted += v * r.cfBps;
            ++d.activeCollateralCount;
        }
        if (d.totalCollateralValue != 0) d.avgCollateralFactor = weighted * 1e14 / d.totalCollateralValue;
        R memory u = reserves[usdcReserveId];
        uint256 debtValue = owed[user] * u.price * 10 ** (26 - uint256(u.decimals) - 8);
        d.totalDebtValueRay = debtValue * RAY;
        d.borrowCount = owed[user] == 0 ? 0 : 1;
        d.healthFactor =
            debtValue == 0 ? type(uint256).max : d.totalCollateralValue * d.avgCollateralFactor / debtValue;
    }

    function _requireSolvent(address user) internal view {
        if (getUserAccountData(user).healthFactor < 1e18) revert HealthFactorBelowThreshold();
    }
}
```

- [ ] **Step 3: Write the tests (fail)**

Create `test/AaveV4CreditAdapter.t.sol`. Numbers: 1 NVDAc at $200 with CF 70% gives value 2e28 and borrowing power of $140. Borrow $50 ⇒ HF 2.8; borrow $100 ⇒ HF 1.4.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {AaveV4CreditAdapter} from "../src/adapters/AaveV4CreditAdapter.sol";
import {ICreditAdapter} from "../src/adapters/ICreditAdapter.sol";
import {MockSpoke} from "./mocks/MockSpoke.sol";
import {MockB20} from "./mocks/MockB20.sol";
import {MockERC20} from "./mocks/MockERC20.sol";

contract AaveV4CreditAdapterTest is Test {
    uint256 internal constant NVDA_ID = 5;
    uint256 internal constant GOOGL_ID = 2;
    uint256 internal constant USDC_ID = 7;
    uint256 internal constant MIN_HF = 1.5e18;

    address internal vault = makeAddr("vault");
    MockERC20 internal usdc;
    MockB20 internal nvda;
    MockB20 internal googl;
    MockSpoke internal spoke;
    AaveV4CreditAdapter internal adapter;

    function setUp() public {
        usdc = new MockERC20("USDC", 6);
        nvda = new MockB20("NVDAc");
        googl = new MockB20("GOOGLc");
        spoke = new MockSpoke();
        spoke.addReserve(NVDA_ID, address(nvda), 8, 200e8, 7000);
        spoke.addReserve(GOOGL_ID, address(googl), 8, 100e8, 7600);
        spoke.addReserve(USDC_ID, address(usdc), 6, 1e8, 0);
        spoke.setUsdcReserve(USDC_ID);
        usdc.mint(address(spoke), 1_000_000e6);
        adapter = _deploy(_one(address(nvda)), _oneId(NVDA_ID));
        nvda.mint(vault, 10e8);
        usdc.mint(vault, 1_000e6);
        vm.startPrank(vault);
        nvda.approve(address(adapter), type(uint256).max);
        usdc.approve(address(adapter), type(uint256).max);
        vm.stopPrank();
    }

    function _deploy(address[] memory toks, uint256[] memory ids) internal returns (AaveV4CreditAdapter) {
        return new AaveV4CreditAdapter(vault, address(usdc), address(spoke), USDC_ID, toks, ids);
    }

    function deployExternal(address[] memory toks, uint256[] memory ids) external returns (AaveV4CreditAdapter) {
        return _deploy(toks, ids);
    }

    function _one(address a) internal pure returns (address[] memory r) {
        r = new address[](1);
        r[0] = a;
    }

    function _oneId(uint256 id) internal pure returns (uint256[] memory r) {
        r = new uint256[](1);
        r[0] = id;
    }

    function _supply(uint256 amount) internal {
        vm.prank(vault);
        adapter.supply(address(nvda), amount);
    }

    function _borrow(uint256 amount) internal {
        vm.prank(vault);
        adapter.borrow(amount, MIN_HF);
    }

    // ------------------------------------------------------------------ constructor

    function test_constructorBindsReserves() public view {
        assertEq(adapter.vault(), vault);
        assertEq(adapter.usdc(), address(usdc));
        assertEq(adapter.hub(), address(spoke));
        assertEq(adapter.collateralCustodian(address(nvda)), address(spoke));
        assertEq(adapter.collateralOperator(), address(spoke));
        assertTrue(adapter.supportsToken(address(nvda)));
        assertFalse(adapter.supportsToken(address(googl)));
        assertEq(adapter.collaterals().length, 1);
    }

    function test_constructorRejectsMismatchedReserve() public {
        vm.expectRevert(abi.encodeWithSelector(AaveV4CreditAdapter.ReserveMismatch.selector, GOOGL_ID));
        this.deployExternal(_one(address(nvda)), _oneId(GOOGL_ID));
    }

    function test_constructorRejectsForeignHub() public {
        spoke.setHub(NVDA_ID, makeAddr("otherHub"));
        vm.expectRevert(abi.encodeWithSelector(AaveV4CreditAdapter.ReserveMismatch.selector, NVDA_ID));
        this.deployExternal(_one(address(nvda)), _oneId(NVDA_ID));
    }

    function test_constructorRejectsWrongUsdcReserve() public {
        vm.expectRevert(abi.encodeWithSelector(AaveV4CreditAdapter.ReserveMismatch.selector, NVDA_ID));
        new AaveV4CreditAdapter(vault, address(usdc), address(spoke), NVDA_ID, new address[](0), new uint256[](0));
    }

    function test_constructorRejectsDuplicateAndBadInput() public {
        address[] memory twice = new address[](2);
        twice[0] = address(nvda);
        twice[1] = address(nvda);
        uint256[] memory ids = new uint256[](2);
        ids[0] = NVDA_ID;
        ids[1] = NVDA_ID;
        vm.expectRevert(abi.encodeWithSelector(AaveV4CreditAdapter.ReserveMismatch.selector, NVDA_ID));
        this.deployExternal(twice, ids);
        vm.expectRevert(AaveV4CreditAdapter.LengthMismatch.selector);
        this.deployExternal(twice, _oneId(NVDA_ID));
        vm.expectRevert(AaveV4CreditAdapter.ZeroAddress.selector);
        new AaveV4CreditAdapter(address(0), address(usdc), address(spoke), USDC_ID, new address[](0), new uint256[](0));
    }

    // ------------------------------------------------------------------ access

    function test_onlyVaultCanMovePosition() public {
        vm.expectRevert(ICreditAdapter.NotVault.selector);
        adapter.supply(address(nvda), 1e8);
        vm.expectRevert(ICreditAdapter.NotVault.selector);
        adapter.withdraw(address(nvda), 1e8, MIN_HF);
        vm.expectRevert(ICreditAdapter.NotVault.selector);
        adapter.borrow(1e6, MIN_HF);
        vm.expectRevert(ICreditAdapter.NotVault.selector);
        adapter.repay(1e6);
    }

    // ------------------------------------------------------------------ supply

    function test_supplyEnablesCollateralOnce() public {
        _supply(1e8);
        assertEq(adapter.suppliedOf(address(nvda)), 1e8);
        assertEq(nvda.balanceOf(address(spoke)), 1e8);
        assertTrue(spoke.usingAsCollateral(NVDA_ID, address(adapter)));
        assertEq(spoke.setCollateralCalls(), 1);
        assertEq(nvda.allowance(address(adapter), address(spoke)), 0);
        _supply(1e8);
        assertEq(spoke.setCollateralCalls(), 1);
        assertTrue(adapter.hasPosition());
    }

    function test_supplyUnsupportedTokenReverts() public {
        vm.prank(vault);
        vm.expectRevert(abi.encodeWithSelector(ICreditAdapter.UnsupportedToken.selector, address(googl)));
        adapter.supply(address(googl), 1e8);
    }

    // ------------------------------------------------------------------ borrow

    function test_borrowSendsUsdcToVaultAndChecksHf() public {
        _supply(1e8);
        _borrow(50e6);
        assertEq(usdc.balanceOf(vault), 1_050e6);
        assertEq(usdc.balanceOf(address(adapter)), 0);
        assertEq(adapter.debt(), 50e6);
        assertEq(adapter.healthFactor(), 2.8e18);
        vm.prank(vault);
        vm.expectRevert(abi.encodeWithSelector(ICreditAdapter.HealthFactorTooLow.selector, 1.4e18, MIN_HF));
        adapter.borrow(50e6, MIN_HF);
    }

    function test_projectionMatchesPostBorrowHf() public {
        assertEq(adapter.projectedHealthFactorAfterBorrow(0), type(uint256).max);
        _supply(1e8);
        _borrow(20e6);
        uint256 projected = adapter.projectedHealthFactorAfterBorrow(30e6);
        _borrow(30e6);
        assertEq(projected, adapter.healthFactor());
        assertEq(projected, 2.8e18);
    }

    // ------------------------------------------------------------------ repay

    function test_repayPullsOnlyDebtAndSweeps() public {
        _supply(1e8);
        _borrow(50e6);
        spoke.accrue(address(adapter), 7); // interest accrued since the agent read the debt
        uint256 before = usdc.balanceOf(vault);
        vm.prank(vault);
        uint256 repaid = adapter.repay(100e6);
        assertEq(repaid, 50e6 + 7);
        assertEq(usdc.balanceOf(vault), before - 50e6 - 7);
        assertEq(adapter.debt(), 0);
        assertEq(usdc.balanceOf(address(adapter)), 0);
        assertEq(usdc.allowance(address(adapter), address(spoke)), 0);
    }

    function test_repayWithoutDebtIsNoop() public {
        uint256 before = usdc.balanceOf(vault);
        vm.prank(vault);
        assertEq(adapter.repay(5e6), 0);
        assertEq(usdc.balanceOf(vault), before);
    }

    // ------------------------------------------------------------------ withdraw

    function test_withdrawReturnsCollateralAndChecksHf() public {
        _supply(1e8);
        _borrow(50e6);
        vm.prank(vault);
        vm.expectRevert(abi.encodeWithSelector(ICreditAdapter.HealthFactorTooLow.selector, 1.4e18, MIN_HF));
        adapter.withdraw(address(nvda), 0.5e8, MIN_HF); // leaves $100 x 70% / $50 = 1.4
        vm.prank(vault);
        assertEq(adapter.withdraw(address(nvda), 0.25e8, MIN_HF), 0.25e8); // leaves 2.1
        assertEq(nvda.balanceOf(vault), 9.25e8);
    }

    function test_withdrawAllWithoutDebtClosesPosition() public {
        _supply(1e8);
        vm.prank(vault);
        assertEq(adapter.withdraw(address(nvda), type(uint256).max, MIN_HF), 1e8);
        assertEq(nvda.balanceOf(vault), 10e8);
        assertFalse(adapter.hasPosition());
    }

    function test_unsupportedTokenHasNothingSupplied() public view {
        assertEq(adapter.suppliedOf(address(googl)), 0);
        assertFalse(adapter.hasPosition());
    }
}
```

- [ ] **Step 4: Run the tests to see them fail**

Run: `forge test --match-path test/AaveV4CreditAdapter.t.sol`
Expected: FAIL at compile: `Source "src/adapters/AaveV4CreditAdapter.sol" not found`.

- [ ] **Step 5: Create `src/adapters/AaveV4CreditAdapter.sol`**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ICreditAdapter} from "./ICreditAdapter.sol";
import {IAaveV4Spoke, IAaveV4Oracle} from "../interfaces/IAaveV4.sol";
import {IERC20Minimal} from "../interfaces/IExternal.sol";
import {TokenTransfer} from "../lib/TokenTransfer.sol";

/// @title AaveV4CreditAdapter — one Aave V4 spoke position owned by one MandateVault.
/// @notice The adapter is the Aave user: it holds the collateral and the debt, and only its vault can move them.
/// Everything withdrawn or borrowed goes straight to the vault. borrow() and withdraw() re-read the health factor
/// after the action and revert below the vault's minimum, so the minimum holds even if a projection was off.
contract AaveV4CreditAdapter is ICreditAdapter {
    using TokenTransfer for address;

    uint256 internal constant RAY = 1e27;
    uint256 internal constant VALUE_DECIMALS = 26; // Aave V4 value units: 1e26 = 1 USD

    address public immutable vault;
    address public immutable usdc;
    IAaveV4Spoke public immutable spoke;
    /// Holds every supplied collateral token; the spoke pulls supplies into it and it sends withdrawals out.
    address public immutable hub;
    uint256 public immutable usdcReserveId;
    /// Converts raw USDC x oracle price into Aave value units.
    uint256 internal immutable _usdcToValue;

    mapping(address => uint256) internal _reserveIdPlusOne;
    address[] internal _collaterals;

    error ZeroAddress();
    error LengthMismatch();
    error ReserveMismatch(uint256 reserveId);

    modifier onlyVault() {
        if (msg.sender != vault) revert NotVault();
        _;
    }

    /// @param tokens_ collateral tokens; reserveIds_[i] is tokens_[i]'s reserve on `spoke_`. Each reserve must list
    /// that token as its underlying and share the USDC reserve's hub.
    constructor(
        address vault_,
        address usdc_,
        address spoke_,
        uint256 usdcReserveId_,
        address[] memory tokens_,
        uint256[] memory reserveIds_
    ) {
        if (vault_ == address(0) || usdc_ == address(0) || spoke_ == address(0)) revert ZeroAddress();
        if (tokens_.length != reserveIds_.length) revert LengthMismatch();
        IAaveV4Spoke s = IAaveV4Spoke(spoke_);
        IAaveV4Spoke.Reserve memory u = s.getReserve(usdcReserveId_);
        if (u.underlying != usdc_ || u.hub == address(0)) revert ReserveMismatch(usdcReserveId_);
        for (uint256 i; i < tokens_.length; ++i) {
            address t = tokens_[i];
            IAaveV4Spoke.Reserve memory r = s.getReserve(reserveIds_[i]);
            if (t == address(0) || t == usdc_ || r.underlying != t || r.hub != u.hub || _reserveIdPlusOne[t] != 0) {
                revert ReserveMismatch(reserveIds_[i]);
            }
            _reserveIdPlusOne[t] = reserveIds_[i] + 1;
            _collaterals.push(t);
        }
        vault = vault_;
        usdc = usdc_;
        spoke = s;
        hub = u.hub;
        usdcReserveId = usdcReserveId_;
        _usdcToValue = 10 ** (VALUE_DECIMALS - uint256(u.decimals) - uint256(IAaveV4Oracle(s.ORACLE()).decimals()));
    }

    // ------------------------------------------------------------------ vault actions

    function supply(address token, uint256 amount) external onlyVault {
        uint256 id = _reserveId(token);
        token.safeTransferFrom(vault, address(this), amount);
        token.safeApprove(address(spoke), amount);
        spoke.supply(id, amount, address(this));
        token.safeApprove(address(spoke), 0);
        // Aave V4 does not enable collateral on supply (research/04 §5)
        (bool enabled,) = spoke.getUserReserveStatus(id, address(this));
        if (!enabled) spoke.setUsingAsCollateral(id, true, address(this));
    }

    function withdraw(address token, uint256 amount, uint256 minHealthFactor)
        external
        onlyVault
        returns (uint256 withdrawn)
    {
        uint256 id = _reserveId(token);
        uint256 before = IERC20Minimal(token).balanceOf(address(this));
        spoke.withdraw(id, amount, address(this));
        _requireHealthy(minHealthFactor);
        withdrawn = IERC20Minimal(token).balanceOf(address(this)) - before;
        token.safeTransfer(vault, withdrawn);
    }

    function borrow(uint256 amount, uint256 minHealthFactor) external onlyVault {
        uint256 before = IERC20Minimal(usdc).balanceOf(address(this));
        spoke.borrow(usdcReserveId, amount, address(this));
        _requireHealthy(minHealthFactor);
        usdc.safeTransfer(vault, IERC20Minimal(usdc).balanceOf(address(this)) - before);
    }

    function repay(uint256 amount) external onlyVault returns (uint256 repaid) {
        uint256 owed = debt();
        repaid = amount < owed ? amount : owed;
        if (repaid != 0) {
            usdc.safeTransferFrom(vault, address(this), repaid);
            usdc.safeApprove(address(spoke), repaid);
            spoke.repay(usdcReserveId, repaid, address(this));
            usdc.safeApprove(address(spoke), 0);
        }
        // whatever the spoke did not take goes back, so no USDC ever rests here
        uint256 left = IERC20Minimal(usdc).balanceOf(address(this));
        if (left != 0) usdc.safeTransfer(vault, left);
    }

    // ------------------------------------------------------------------ views

    function supportsToken(address token) external view returns (bool) {
        return _reserveIdPlusOne[token] != 0;
    }

    function collaterals() external view returns (address[] memory) {
        return _collaterals;
    }

    function suppliedOf(address token) public view returns (uint256) {
        uint256 p = _reserveIdPlusOne[token];
        return p == 0 ? 0 : spoke.getUserSuppliedAssets(p - 1, address(this));
    }

    function debt() public view returns (uint256) {
        return spoke.getUserTotalDebt(usdcReserveId, address(this));
    }

    function healthFactor() public view returns (uint256) {
        return spoke.getUserAccountData(address(this)).healthFactor;
    }

    function hasPosition() external view returns (bool) {
        if (debt() != 0) return true;
        for (uint256 i; i < _collaterals.length; ++i) {
            if (suppliedOf(_collaterals[i]) != 0) return true;
        }
        return false;
    }

    /// @notice HF = collateral value x avgCF / debt value, with the new debt valued at the spoke oracle's USDC
    /// price. Matched Aave's own post-borrow HF on a Base fork (research/04 §5). Existing debt is rounded up.
    function projectedHealthFactorAfterBorrow(uint256 amount) external view returns (uint256) {
        IAaveV4Spoke.UserAccountData memory d = spoke.getUserAccountData(address(this));
        uint256 price = IAaveV4Oracle(spoke.ORACLE()).getReservePrice(usdcReserveId);
        uint256 debtValue = _ceilDiv(d.totalDebtValueRay, RAY) + amount * price * _usdcToValue;
        if (debtValue == 0) return type(uint256).max;
        return d.totalCollateralValue * d.avgCollateralFactor / debtValue;
    }

    function collateralCustodian(address) external view returns (address) {
        return hub;
    }

    function collateralOperator() external view returns (address) {
        return address(spoke);
    }

    // ------------------------------------------------------------------ internal

    function _reserveId(address token) internal view returns (uint256) {
        uint256 p = _reserveIdPlusOne[token];
        if (p == 0) revert UnsupportedToken(token);
        return p - 1;
    }

    function _requireHealthy(uint256 minHealthFactor) internal view {
        uint256 hf = healthFactor();
        if (hf < minHealthFactor) revert HealthFactorTooLow(hf, minHealthFactor);
    }

    function _ceilDiv(uint256 a, uint256 b) internal pure returns (uint256) {
        return a == 0 ? 0 : (a - 1) / b + 1;
    }
}
```

- [ ] **Step 6: Run the tests to see them pass**

Run: `forge test --match-path test/AaveV4CreditAdapter.t.sol -vv`
Expected: PASS (15 tests).

Run: `forge test --no-match-path "test/fork/*"`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add src/interfaces/IAaveV4.sol src/adapters/AaveV4CreditAdapter.sol test/mocks/MockSpoke.sol test/AaveV4CreditAdapter.t.sol
git commit -m "feat: add the Aave V4 credit adapter

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Fork test of the adapter on the real Aave V4

**Files:**
- Modify: `contracts/script/BaseAddresses.sol`
- Modify: `contracts/script/MaatConfig.sol`
- Create: `contracts/test/fork/AaveV4CreditAdapterFork.t.sol`

**Interfaces:**
- Consumes: Task 6 `AaveV4CreditAdapter`, `IAaveV4Spoke`; Plan 1 `AerodromeSwapAdapter.swapExactIn(pool, tokenIn, amountIn, minOut, recipient)`.
- Produces: constants `BaseAddresses.AAVE_MAG7_SPOKE`, `AAVE_EQUITIES_HUB`, `AAVE_MAG7_ORACLE`, `AAVE_RESERVE_AAPLC = 0`, `AAVE_RESERVE_GOOGLC = 2`, `AAVE_RESERVE_NVDAC = 5`, `AAVE_RESERVE_USDC = 7`; `MaatConfig.creditReserves() returns (address[] memory toks, uint256[] memory ids)` (NVDAc, GOOGLc, AAPLc).

- [ ] **Step 1: Add the Aave constants to `BaseAddresses.sol`**

Add before `BLOCK_SESSION`:

```solidity
    /// Aave V4 Equities Hub on Base (research/03-aave-v4-equities-hub.md, verified 2026-11-06).
    /// On the MAG7 spoke reserveId == hub assetId.
    address internal constant AAVE_MAG7_SPOKE = 0x17905Db0e4A3514467539956c084180616AE7B8D;
    address internal constant AAVE_EQUITIES_HUB = 0xa4d5947Eb727A052bae69C593FfC84247EC9864E;
    address internal constant AAVE_MAG7_ORACLE = 0xaBaf048fD7675Ea34a84332371ffd5D55E322A47;
    uint256 internal constant AAVE_RESERVE_AAPLC = 0;
    uint256 internal constant AAVE_RESERVE_GOOGLC = 2;
    uint256 internal constant AAVE_RESERVE_NVDAC = 5;
    uint256 internal constant AAVE_RESERVE_USDC = 7;
```

If the compiler reports a wrong checksum for an address, use the exact checksum string the compiler suggests (the hex value does not change) and record it in the report.

- [ ] **Step 2: Add `creditReserves()` to `MaatConfig.sol`**

```solidity
    /// Aave V4 MAG7 reserves for the basket, in basket order.
    function creditReserves() internal pure returns (address[] memory toks, uint256[] memory ids) {
        toks = new address[](3);
        ids = new uint256[](3);
        toks[0] = A.NVDAC;
        ids[0] = A.AAVE_RESERVE_NVDAC;
        toks[1] = A.GOOGLC;
        ids[1] = A.AAVE_RESERVE_GOOGLC;
        toks[2] = A.AAPLC;
        ids[2] = A.AAVE_RESERVE_AAPLC;
    }
```

- [ ] **Step 3: Write the fork test**

Create `test/fork/AaveV4CreditAdapterFork.t.sol`. The test contract plays the role of the vault. NVDAc is a precompile, so `deal` cannot be used on it: buy it for real through the Aerodrome pool, as in the spike.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {AaveV4CreditAdapter} from "../../src/adapters/AaveV4CreditAdapter.sol";
import {AerodromeSwapAdapter} from "../../src/adapters/AerodromeSwapAdapter.sol";
import {ICreditAdapter} from "../../src/adapters/ICreditAdapter.sol";
import {IAaveV4Spoke} from "../../src/interfaces/IAaveV4.sol";
import {IB20Asset} from "../../src/interfaces/IB20Asset.sol";
import {IERC20Minimal} from "../../src/interfaces/IExternal.sol";
import {BaseAddresses as A} from "../../script/BaseAddresses.sol";
import {MaatConfig} from "../../script/MaatConfig.sol";

contract AaveV4CreditAdapterForkTest is Test {
    uint256 internal constant MIN_HF = 1.5e18;
    AaveV4CreditAdapter internal adapter;
    uint256 internal collateral;

    function setUp() public {
        vm.createSelectFork("base", A.BLOCK_SESSION);
        (address[] memory toks, uint256[] memory ids) = MaatConfig.creditReserves();
        adapter = new AaveV4CreditAdapter(address(this), A.USDC, A.AAVE_MAG7_SPOKE, A.AAVE_RESERVE_USDC, toks, ids);
        AerodromeSwapAdapter swap = new AerodromeSwapAdapter();
        deal(A.USDC, address(this), 100e6);
        IERC20Minimal(A.USDC).approve(address(swap), 20e6);
        collateral = swap.swapExactIn(A.NVDAC_USDC_POOL, A.USDC, 20e6, 0, address(this)); // ~10.7e6 raw
        IB20Asset(A.NVDAC).approve(address(adapter), type(uint256).max);
        IERC20Minimal(A.USDC).approve(address(adapter), type(uint256).max);
    }

    function _usdc(address a) internal view returns (uint256) {
        return IERC20Minimal(A.USDC).balanceOf(a);
    }

    function test_reservesMatchOnchain() public view {
        assertEq(adapter.hub(), A.AAVE_EQUITIES_HUB);
        assertEq(adapter.collateralOperator(), A.AAVE_MAG7_SPOKE);
        assertTrue(adapter.supportsToken(A.NVDAC));
        assertTrue(adapter.supportsToken(A.GOOGLC));
        assertTrue(adapter.supportsToken(A.AAPLC));
    }

    function test_fullCreditLoopOnAave() public {
        adapter.supply(A.NVDAC, collateral);
        assertEq(adapter.suppliedOf(A.NVDAC), collateral);
        (bool enabled,) = IAaveV4Spoke(A.AAVE_MAG7_SPOKE).getUserReserveStatus(A.AAVE_RESERVE_NVDAC, address(adapter));
        assertTrue(enabled);

        uint256 projected = adapter.projectedHealthFactorAfterBorrow(5e6);
        uint256 before = _usdc(address(this));
        adapter.borrow(5e6, MIN_HF);
        assertEq(_usdc(address(this)), before + 5e6);
        assertEq(_usdc(address(adapter)), 0);
        assertApproxEqRel(adapter.healthFactor(), projected, 1e12); // within 1e-6
        assertApproxEqRel(adapter.healthFactor(), 2.7979e18, 0.01e18); // research/04 §5
        assertTrue(adapter.hasPosition());

        vm.warp(vm.getBlockTimestamp() + 1 hours);
        uint256 owed = adapter.debt();
        assertGt(owed, 5e6); // interest accrued
        before = _usdc(address(this));
        adapter.repay(10e6);
        assertEq(adapter.debt(), 0);
        assertApproxEqAbs(_usdc(address(this)), before - owed, 1);
        assertEq(_usdc(address(adapter)), 0);

        assertEq(adapter.withdraw(A.NVDAC, type(uint256).max, MIN_HF), collateral);
        assertEq(IB20Asset(A.NVDAC).balanceOf(address(this)), collateral);
        assertFalse(adapter.hasPosition());
    }

    function test_borrowBelowMinimumHealthFactorReverts() public {
        adapter.supply(A.NVDAC, collateral);
        // $19.98 x 70% = $13.99 of capacity; $10 leaves HF ~1.40 < 1.5
        vm.expectPartialRevert(ICreditAdapter.HealthFactorTooLow.selector);
        adapter.borrow(10e6, MIN_HF);
    }
}
```

- [ ] **Step 4: Run the fork test**

Run: `set -a; source .env; set +a; forge test --match-path test/fork/AaveV4CreditAdapterFork.t.sol -vvv`
Expected: PASS (3 tests). If `supply` reverts because of the B20 policy (`PolicyForbids`) or Aave changed its interface, stop and report BLOCKED with the `-vvvv` trace; do not change the test to make it pass.

Run: `forge test --no-match-path "test/fork/*"`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add script/BaseAddresses.sol script/MaatConfig.sol test/fork/AaveV4CreditAdapterFork.t.sol
git commit -m "test: run the Aave V4 adapter against the real MAG7 spoke on a Base fork

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Fork test of the full credit loop through the vault

**Files:**
- Create: `contracts/test/fork/MandateVaultCreditFork.t.sol`

**Interfaces:**
- Consumes: Task 1 `MaatConfig.defaultMandate(mode, calendar, swapAdapter, creditAdapter)`; Task 6 `AaveV4CreditAdapter`; Task 7 Aave constants, `MaatConfig.creditReserves()`; Plan 1 `MaatConfig.basket()`.
- Produces: onchain evidence for the demo: BUY → SUPPLY → BORROW → PAY_EXPENSE → REPAY → WITHDRAW within a session; on the weekend BORROW is blocked while REPAY and WITHDRAW (once the debt is gone) still work.

- [ ] **Step 1: Write the fork test**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {MandateVault} from "../../src/MandateVault.sol";
import {MarketCalendar} from "../../src/MarketCalendar.sol";
import {AerodromeSwapAdapter} from "../../src/adapters/AerodromeSwapAdapter.sol";
import {AaveV4CreditAdapter} from "../../src/adapters/AaveV4CreditAdapter.sol";
import {Action, Reason, SessionMode, Intent, TokenConfig} from "../../src/Types.sol";
import {IB20Asset} from "../../src/interfaces/IB20Asset.sol";
import {IERC20Minimal} from "../../src/interfaces/IExternal.sol";
import {BaseAddresses as A} from "../../script/BaseAddresses.sol";
import {MaatConfig} from "../../script/MaatConfig.sol";

contract MandateVaultCreditForkTest is Test {
    uint256 internal constant SAT_1300_ET = 1794074400; // Sat 2026-11-07 18:00 UTC, two days after BLOCK_SESSION

    address internal owner = makeAddr("owner");
    address internal executor = makeAddr("executor");
    address internal payee = makeAddr("payee");
    MandateVault internal vault;
    AaveV4CreditAdapter internal credit;
    uint256 internal nonce;

    function setUp() public {
        vm.createSelectFork("base", A.BLOCK_SESSION);
        MarketCalendar calendar = new MarketCalendar(owner);
        AerodromeSwapAdapter swap = new AerodromeSwapAdapter();
        (address[] memory ctoks, uint256[] memory ids) = MaatConfig.creditReserves();
        address predicted = vm.computeCreateAddress(address(this), vm.getNonce(address(this)) + 1);
        credit = new AaveV4CreditAdapter(predicted, A.USDC, A.AAVE_MAG7_SPOKE, A.AAVE_RESERVE_USDC, ctoks, ids);
        (address[] memory toks, TokenConfig[] memory cfgs) = MaatConfig.basket();
        address[] memory payees = new address[](1);
        payees[0] = payee;
        vault = new MandateVault(
            owner,
            executor,
            A.USDC,
            A.POLICY_REGISTRY,
            MaatConfig.defaultMandate(SessionMode.REGULAR, address(calendar), address(swap), address(credit)),
            toks,
            cfgs,
            payees
        );
        assertEq(address(vault), predicted);
        deal(A.USDC, address(vault), 200e6);
        vault.notifyRevenue();
    }

    function _exec(Action a, address token, uint256 amount, address to) internal returns (Reason r) {
        Intent memory i = Intent({
            id: keccak256(abi.encode(++nonce)),
            action: a,
            token: token,
            amount: amount,
            minOut: 0,
            payee: to,
            rationaleHash: keccak256("fork-credit")
        });
        vm.prank(executor, executor);
        (, r) = vault.execute(i);
    }

    function _ok(Action a, address token, uint256 amount, address to) internal {
        assertEq(uint8(_exec(a, token, amount, to)), uint8(Reason.OK));
    }

    function _usdc(address a) internal view returns (uint256) {
        return IERC20Minimal(A.USDC).balanceOf(a);
    }

    /// @dev BUY $20 NVDAc, supply all of it, return the raw amount supplied.
    function _buyAndSupply() internal returns (uint256 stock) {
        _ok(Action.BUY, A.NVDAC, 20e6, address(0));
        stock = IB20Asset(A.NVDAC).balanceOf(address(vault));
        _ok(Action.SUPPLY, A.NVDAC, stock, address(0));
        assertEq(credit.suppliedOf(A.NVDAC), stock);
    }

    function test_creditLoopInSession() public {
        uint256 stock = _buyAndSupply();

        // $19.98 x 70% / $10 = HF 1.40 < 1.5; $5 gives HF ~2.80
        assertEq(uint8(_exec(Action.BORROW, A.USDC, 10e6, address(0))), uint8(Reason.HEALTH_FACTOR_LOW));
        _ok(Action.BORROW, A.USDC, 5e6, address(0));
        assertEq(vault.notifyRevenue(), 0); // borrowed USDC is not revenue

        _ok(Action.PAY_EXPENSE, A.USDC, 3e6, payee);
        assertEq(_usdc(payee), 3e6);

        _ok(Action.REPAY, A.USDC, 10e6, address(0)); // more than owed: only the debt is pulled
        assertEq(credit.debt(), 0);
        _ok(Action.WITHDRAW_COLLATERAL, A.NVDAC, stock, address(0));
        assertEq(IB20Asset(A.NVDAC).balanceOf(address(vault)), stock);
        assertFalse(credit.hasPosition());
        assertEq(_usdc(address(credit)), 0);
        // 200 - 20 buy + 5 borrow - 3 expense - 5 repay (+ wei of interest); the NVDAc is still held
        assertApproxEqAbs(_usdc(address(vault)), 177e6, 10);
    }

    function test_weekendBlocksBorrowButAllowsRepayAndWithdraw() public {
        uint256 stock = _buyAndSupply();
        _ok(Action.BORROW, A.USDC, 5e6, address(0));

        vm.warp(SAT_1300_ET);
        assertEq(uint8(_exec(Action.BORROW, A.USDC, 1e6, address(0))), uint8(Reason.MARKET_CLOSED));
        // collateral against open debt stays put while the market is closed
        assertEq(uint8(_exec(Action.WITHDRAW_COLLATERAL, A.NVDAC, stock, address(0))), uint8(Reason.MARKET_CLOSED));
        _ok(Action.REPAY, A.USDC, 10e6, address(0));
        assertEq(credit.debt(), 0);
        _ok(Action.WITHDRAW_COLLATERAL, A.NVDAC, stock, address(0));
        assertEq(IB20Asset(A.NVDAC).balanceOf(address(vault)), stock);
    }
}
```

- [ ] **Step 2: Run the fork test**

Run: `set -a; source .env; set +a; forge test --match-path test/fork/MandateVaultCreditFork.t.sol -vvv`
Expected: PASS (2 tests). If a step returns a different reason than expected, rerun with `-vvvv`, find the cause (systematic debugging) and report it in the report; do not change an assertion to make the test pass.

Run: `forge test --no-match-path "test/fork/*"`
Expected: all PASS.

- [ ] **Step 3: Commit**

```bash
git add test/fork/MandateVaultCreditFork.t.sol
git commit -m "test: run the full vault credit loop on Aave V4 on a Base fork

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Deploy v1 (4 contracts, precomputed vault address)

**Files:**
- Modify: `contracts/script/Deploy.s.sol`
- Modify: `contracts/test/fork/DeployFork.t.sol`
- Modify: `contracts/.env.example`
- Modify: `deployments/README.md`

**Interfaces:**
- Consumes: Task 1 `MaatConfig.defaultMandate(…, creditAdapter)`; Task 6 `AaveV4CreditAdapter`; Task 7 Aave constants, `MaatConfig.creditReserves()`.
- Produces: `Deploy.run() returns (MarketCalendar calendar, AerodromeSwapAdapter swapAdapter, AaveV4CreditAdapter creditAdapter, MandateVault vault)`. New env `MAAT_DEPLOYER` (address of the wallet that signs the broadcast).

- [ ] **Step 1: Edit `DeployFork.t.sol` (fail)**

Replace the `AerodromeSwapAdapter` import with two lines:

```solidity
import {AerodromeSwapAdapter} from "../../src/adapters/AerodromeSwapAdapter.sol";
import {AaveV4CreditAdapter} from "../../src/adapters/AaveV4CreditAdapter.sol";
```

In `test_deployWiresEverything`, right after `vm.setEnv("MAAT_EXPENSE_PAYEE", …);` add:

```solidity
        vm.setEnv("MAAT_DEPLOYER", vm.toString(makeAddr("deployer")));
```

Replace the line that calls `run()`:

```solidity
        (MarketCalendar calendar, AerodromeSwapAdapter adapter, AaveV4CreditAdapter credit, MandateVault vault) =
            new Deploy().run();
```

After `assertEq(calendar.owner(), owner);` add:

```solidity
        assertEq(vault.mandate().creditAdapter, address(credit));
        assertEq(credit.vault(), address(vault));
        assertEq(credit.usdc(), A.USDC);
        assertEq(credit.hub(), A.AAVE_EQUITIES_HUB);
        assertEq(address(credit.spoke()), A.AAVE_MAG7_SPOKE);
        assertEq(credit.collaterals().length, 3);
```

Replace the line that computes the expected mandate:

```solidity
        Mandate memory m =
            MaatConfig.defaultMandate(SessionMode.REGULAR, address(calendar), address(adapter), address(credit));
```

Run: `set -a; source .env; set +a; forge test --match-path test/fork/DeployFork.t.sol`
Expected: FAIL at compile: `Different number of components on the left hand side (4) than on the right hand side (3)`.

- [ ] **Step 2: Edit `Deploy.s.sol`**

Replace the whole file with:

```solidity
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
```

- [ ] **Step 3: Run the tests to see them pass**

Run: `set -a; source .env; set +a; forge test --match-path test/fork/DeployFork.t.sol -vv`
Expected: PASS.

Run: `forge test --match-path "test/fork/*"`
Expected: all fork tests PASS (Plan 1 + Task 7 + Task 8 + DeployFork).

Run: `forge test --no-match-path "test/fork/*"`
Expected: all unit tests PASS.

Dry-run the script (no broadcast, no key needed):

```bash
MAAT_DEPLOYER=0x0000000000000000000000000000000000000004 \
MAAT_OWNER=0x0000000000000000000000000000000000000001 \
MAAT_EXECUTOR=0x0000000000000000000000000000000000000002 \
MAAT_EXPENSE_PAYEE=0x0000000000000000000000000000000000000003 \
forge script script/Deploy.s.sol --fork-url "$BASE_RPC_URL"
```

Expected: the script finishes, prints 8 address lines, and there is no `vault address mismatch`. Record the estimated total gas in the report.

- [ ] **Step 4: Update `.env.example`**

Add after the line `BASE_RPC_URL=…`:

```
# Address of the wallet that signs the broadcast (the same wallet as --account). The script uses this wallet's nonce to precompute the vault address.
MAAT_DEPLOYER=0x0000000000000000000000000000000000000000
```

- [ ] **Step 5: Update `deployments/README.md`**

Replace the table at the top of the file with:

```markdown
| Network | Contract | Address | Tx | Date |
|---|---|---|---|---|
| Base mainnet | MarketCalendar | | | |
| Base mainnet | AerodromeSwapAdapter | | | |
| Base mainnet | AaveV4CreditAdapter | | | |
| Base mainnet | MandateVault | | | |
```

In the section "Default mandate", add the paragraph:

```markdown
Credit (Aave V4 MAG7 Spoke): `minHealthFactor = 1.5`, `targetHealthFactor = 2.0` (buffer included), `deriskWindow = 4h` before 20:00 ET on Friday. Borrowing is allowed only when the market is open and HF after the borrow is ≥ 1.5 (≥ 2.0 inside the window). Repay and adding collateral are always allowed.
```

In the dry-run command block, add the line `MAAT_DEPLOYER=0x0000000000000000000000000000000000000004 \` right before the line `MAAT_OWNER=…`.

In "Checklist before broadcasting", replace the gas line with:

```markdown
- [ ] The deployer wallet has enough **ETH on Base** to pay for gas (4 contracts). See the estimated total gas at the end of the dry-run output; top up with a margin because the gas price changes.
- [ ] `MAAT_DEPLOYER` is **exactly the address of the `--account` wallet** used to broadcast. The script precomputes the vault address from the nonce of this wallet; if the wrong wallet is used, or the wallet sends another transaction between the simulation and the broadcast, the script stops at `vault address mismatch` (no contract is usable yet, only gas is lost).
```

In the section "Deploy mainnet", change the sentence "Edit `contracts/.env`: …" to:

```markdown
Edit `contracts/.env`: `MAAT_DEPLOYER` is the address of the `maat-owner` wallet; `MAAT_OWNER`, `MAAT_EXECUTOR` (temporarily your own wallet) and `MAAT_EXPENSE_PAYEE` are all set to your wallet address. Add `ETHERSCAN_API_KEY` (an Etherscan v2 key works for Basescan).
```

Add a new section at the end of the file:

````markdown
## Credit smoke test (owner only, after the BUY smoke test)

During session hours, once the vault already has NVDAc from the BUY smoke test. Action codes: SUPPLY = 2, WITHDRAW_COLLATERAL = 3, BORROW = 4, REPAY = 5. New reasons: CREDIT_FAILED = 17, HEALTH_FACTOR_LOW = 18, DERISK_WINDOW = 19.

```bash
NVDAC=0xb20000000000000000000078ee7ce2fE4908108C
STOCK=$(cast call "$NVDAC" "balanceOf(address)(uint256)" "$VAULT" --rpc-url "$BASE_RPC_URL" | cut -d' ' -f1)
EXEC="execute((bytes32,uint8,address,uint256,uint256,address,bytes32))"
ZERO=0x0000000000000000000000000000000000000000
cast send "$VAULT" "$EXEC" "($(cast keccak maat-credit-1),2,$NVDAC,$STOCK,0,$ZERO,$(cast keccak smoke))" --rpc-url "$BASE_RPC_URL" --account maat-owner
cast send "$VAULT" "$EXEC" "($(cast keccak maat-credit-2),4,$USDC,1000000,0,$ZERO,$(cast keccak smoke))" --rpc-url "$BASE_RPC_URL" --account maat-owner
cast send "$VAULT" "$EXEC" "($(cast keccak maat-credit-3),5,$USDC,2000000,0,$ZERO,$(cast keccak smoke))" --rpc-url "$BASE_RPC_URL" --account maat-owner
cast send "$VAULT" "$EXEC" "($(cast keccak maat-credit-4),3,$NVDAC,$STOCK,0,$ZERO,$(cast keccak smoke))" --rpc-url "$BASE_RPC_URL" --account maat-owner
```

Expected: all four `Decision`s have `allowed=true`. After the 2 USDC REPAY command, only about 1 USDC (debt + interest) is deducted from the vault. After the last command, the NVDAc is back in the vault.
````

- [ ] **Step 6: Commit**

```bash
git add script/Deploy.s.sol test/fork/DeployFork.t.sol .env.example ../deployments/README.md
git commit -m "feat: deploy the Aave V4 credit adapter alongside the vault

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## After Plan 2A

- The owner deploys v1 to mainnet following `deployments/README.md` (the owner signs), runs the BUY smoke test and then the credit smoke test.
- Write Plan 2B (agent runtime, CDP executor, Builder Code), using the ABI of the contracts in this plan.
