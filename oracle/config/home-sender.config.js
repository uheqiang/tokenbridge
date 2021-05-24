const baseConfig = require('./base.config')

const { DEFAULT_TRANSACTION_RESEND_INTERVAL } = require('../src/utils/constants')
// For Ethereum
// const { web3Home, web3HomeRedundant, web3HomeFallback } = require('../src/services/web3')
// For KHC
const { khcWebHome, khcWebHomeRedundant, khcWebHomeFallback } = require('../src/services/khcWeb3')

const { ORACLE_HOME_TX_RESEND_INTERVAL } = process.env

module.exports = {
  ...baseConfig.bridgeConfig,
  queue: 'home-prioritized',
  oldQueue: 'home',
  id: 'home',
  name: 'sender-home',
  web3: khcWebHome,
  web3Redundant: khcWebHomeRedundant,
  web3Fallback: khcWebHomeFallback,
  resendInterval: parseInt(ORACLE_HOME_TX_RESEND_INTERVAL, 10) || DEFAULT_TRANSACTION_RESEND_INTERVAL
}
