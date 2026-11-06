// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice One lending position owned by one MandateVault. Stock amounts are raw units, USDC has 6 decimals,
/// health factors are WAD (1e18 = 1.00; type(uint256).max with no debt).
/// @dev The vault trusts the adapter's view return data (the adapter is allowlisted in the mandate and checked to
/// be bound to the vault). Mutations are low-level calls whose return data is ignored, so neither a revert nor
/// malformed return data can revert the vault's execute().
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
    /// @notice Returns 0 (never reverts) for tokens the adapter does not support; the vault reads it for every listed token.
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
