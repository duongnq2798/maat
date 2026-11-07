// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice Subset of the Aave V4 Spoke (ISpoke.sol, aave/aave-v4 main @ a3ef63ea) and its oracle used by Maat.
/// Selectors were checked against the MAG7 Spoke implementation on Base.
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
