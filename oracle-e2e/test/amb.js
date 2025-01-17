const Web3 = require('web3')
const assert = require('assert')
const { user, homeRPC, foreignRPC, amb, validator } = require('../../e2e-commons/constants.json')
const { uniformRetry } = require('../../e2e-commons/utils')
const { BOX_ABI, HOME_AMB_ABI, FOREIGN_AMB_ABI } = require('../../commons')
const { delay, setRequiredSignatures } = require('./utils')

const { toBN } = Web3.utils

const homeWeb3 = new Web3(new Web3.providers.HttpProvider(homeRPC.URL))
const foreignWeb3 = new Web3(new Web3.providers.HttpProvider(foreignRPC.URL))

homeWeb3.eth.accounts.wallet.add(user.privateKey)
homeWeb3.eth.accounts.wallet.add(validator.privateKey)
foreignWeb3.eth.accounts.wallet.add(user.privateKey)
foreignWeb3.eth.accounts.wallet.add(validator.privateKey)

const opts = {
  from: user.address,
  gas: 400000,
  gasPrice: '1'
}
const homeBox = new homeWeb3.eth.Contract(BOX_ABI, amb.homeBox, opts)
const blockHomeBox = new homeWeb3.eth.Contract(BOX_ABI, amb.blockedHomeBox, opts)
const foreignBox = new foreignWeb3.eth.Contract(BOX_ABI, amb.foreignBox, opts)
const homeBridge = new homeWeb3.eth.Contract(HOME_AMB_ABI, amb.home, opts)
const foreignBridge = new foreignWeb3.eth.Contract(FOREIGN_AMB_ABI, amb.foreign, opts)

describe('arbitrary message bridging', () => {
  let requiredSignatures = 1
  before(async () => {
    const allowedMethods = [
      'eth_call(address,bytes)',
      'eth_call(address,bytes,uint256)',
      'eth_call(address,address,uint256,bytes)',
      'eth_blockNumber()',
      'eth_getBlockByNumber()',
      'eth_getBlockByNumber(uint256)',
      'eth_getBlockByHash(bytes32)',
      'eth_getBalance(address)',
      'eth_getBalance(address,uint256)',
      'eth_getTransactionCount(address)',
      'eth_getTransactionCount(address,uint256)',
      'eth_getTransactionByHash(bytes32)',
      'eth_getTransactionReceipt(bytes32)',
      'eth_getStorageAt(address,bytes32)',
      'eth_getStorageAt(address,bytes32,uint256)'
    ]
    for (const method of allowedMethods) {
      const selector = homeWeb3.utils.soliditySha3(method)
      await homeBridge.methods.enableAsyncRequestSelector(selector, true).send({ from: validator.address })
    }

    // Only 1 validator is used in ultimate tests
    if (process.env.ULTIMATE === 'true') {
      return
    }
    console.log('Calling setRequiredSignatures(2)')

    requiredSignatures = 2
    // Set 2 required signatures for home bridge
    await setRequiredSignatures({
      bridgeContract: homeBridge,
      web3: homeWeb3,
      requiredSignatures: 2,
      options: {
        from: validator.address,
        gas: '4000000'
      }
    })

    // Set 2 required signatures for foreign bridge
    await setRequiredSignatures({
      bridgeContract: foreignBridge,
      web3: foreignWeb3,
      requiredSignatures: 2,
      options: {
        from: validator.address,
        gas: '4000000'
      }
    })
  })
  describe('Home to Foreign', () => {
    describe('Subsidized Mode', () => {
      it('should bridge message', async () => {
        const newValue = 3

        const initialValue = await foreignBox.methods.value().call()
        assert(!toBN(initialValue).eq(toBN(newValue)), 'initial value should be different from new value')

        await homeBox.methods
          .setValueOnOtherNetwork(newValue, amb.home, amb.foreignBox)
          .send()
          .catch(e => {
            console.error(e)
          })

        // check that value changed and balance decreased
        await uniformRetry(async retry => {
          const value = await foreignBox.methods.value().call()
          if (!toBN(value).eq(toBN(newValue))) {
            retry()
          }
        })
      })

      // allowance/block lists files are not mounted to the host during the ultimate test
      if (process.env.ULTIMATE !== 'true') {
        it('should confirm but not relay message from blocked contract', async () => {
          const newValue = 4

          const initialValue = await foreignBox.methods.value().call()
          assert(!toBN(initialValue).eq(toBN(newValue)), 'initial value should be different from new value')

          const signatures = await homeBridge.getPastEvents('SignedForUserRequest', {
            fromBlock: 0,
            toBlock: 'latest'
          })

          await blockHomeBox.methods
            .setValueOnOtherNetwork(newValue, amb.home, amb.foreignBox)
            .send()
            .catch(e => {
              console.error(e)
            })

          await delay(5000)

          const newSignatures = await homeBridge.getPastEvents('SignedForUserRequest', {
            fromBlock: 0,
            toBlock: 'latest'
          })

          assert(
            newSignatures.length === signatures.length + requiredSignatures,
            `Incorrect amount of signatures submitted, got ${newSignatures.length}, expected ${signatures.length +
              requiredSignatures}`
          )

          const value = await foreignBox.methods.value().call()
          assert(!toBN(value).eq(toBN(newValue)), 'Message should not be relayed by oracle automatically')
        })
      }

      it('should confirm but not relay message from manual lane', async () => {
        const newValue = 5

        const initialValue = await foreignBox.methods.value().call()
        assert(!toBN(initialValue).eq(toBN(newValue)), 'initial value should be different from new value')

        const signatures = await homeBridge.getPastEvents('SignedForUserRequest', {
          fromBlock: 0,
          toBlock: 'latest'
        })

        await homeBox.methods
          .setValueOnOtherNetworkUsingManualLane(newValue, amb.home, amb.foreignBox)
          .send()
          .catch(e => {
            console.error(e)
          })

        await delay(10000)

        const newSignatures = await homeBridge.getPastEvents('SignedForUserRequest', {
          fromBlock: 0,
          toBlock: 'latest'
        })

        assert(
          newSignatures.length === signatures.length + requiredSignatures,
          `Incorrect amount of signatures submitted, got ${newSignatures.length}, expected ${signatures.length +
            requiredSignatures}`
        )

        const value = await foreignBox.methods.value().call()
        assert(!toBN(value).eq(toBN(newValue)), 'Message should not be relayed by oracle automatically')
      })
    })
  })
  describe('Foreign to Home', () => {
    describe('Subsidized Mode', () => {
      it('should bridge message', async () => {
        const newValue = 7

        const initialValue = await homeBox.methods.value().call()
        assert(!toBN(initialValue).eq(toBN(newValue)), 'initial value should be different from new value')

        await foreignBox.methods
          .setValueOnOtherNetwork(newValue, amb.foreign, amb.homeBox)
          .send()
          .catch(e => {
            console.error(e)
          })

        // check that value changed and balance decreased
        await uniformRetry(async retry => {
          const value = await homeBox.methods.value().call()
          if (!toBN(value).eq(toBN(newValue))) {
            retry()
          }
        })
      })
    })
  })
  describe('Home to Foreign Async Call', () => {
    async function makeAsyncCall(selector, data) {
      const prevMessageId = await homeBox.methods.messageId().call()

      await homeBox.methods
        .makeAsyncCall(amb.home, selector, data)
        .send()
        .catch(e => {
          console.error(e)
        })

      // check that value changed and balance decreased
      await uniformRetry(async retry => {
        const messageId = await homeBox.methods.messageId().call()
        if (messageId === prevMessageId) {
          retry()
        }
      })
    }

    it('should make async eth_call', async () => {
      const foreignValue = await foreignBox.methods.value().call()
      const selector = homeWeb3.utils.soliditySha3('eth_call(address,bytes)')
      const data = homeWeb3.eth.abi.encodeParameters(
        ['address', 'bytes'],
        [amb.foreignBox, foreignBox.methods.value().encodeABI()]
      )

      await makeAsyncCall(selector, data)

      assert(await homeBox.methods.status().call(), 'status is false')
      assert.strictEqual(
        await homeBox.methods.data().call(),
        homeWeb3.eth.abi.encodeParameters(['bytes'], [homeWeb3.eth.abi.encodeParameter('uint256', foreignValue)]),
        'returned data is incorrect'
      )
    })

    it('should make async eth_call with 4 arguments', async () => {
      const foreignValue = await foreignBox.methods.value().call()
      const selector = homeWeb3.utils.soliditySha3('eth_call(address,address,uint256,bytes)')
      const data1 = homeWeb3.eth.abi.encodeParameters(
        ['address', 'address', 'uint256', 'bytes'],
        [amb.foreignBox, user.address, '100000', foreignBox.methods.value().encodeABI()]
      )

      await makeAsyncCall(selector, data1)

      assert(await homeBox.methods.status().call(), 'status is false')
      assert.strictEqual(
        await homeBox.methods.data().call(),
        homeWeb3.eth.abi.encodeParameters(['bytes'], [homeWeb3.eth.abi.encodeParameter('uint256', foreignValue)]),
        'returned data is incorrect'
      )

      const data2 = homeWeb3.eth.abi.encodeParameters(
        ['address', 'address', 'uint256', 'bytes'],
        [amb.foreignBox, user.address, '1000', foreignBox.methods.value().encodeABI()]
      )

      await makeAsyncCall(selector, data2)

      assert(!(await homeBox.methods.status().call()), 'status is true')
      assert.strictEqual(await homeBox.methods.data().call(), null, 'returned data is incorrect')

      const data3 = homeWeb3.eth.abi.encodeParameters(
        ['address', 'address', 'uint256', 'bytes'],
        [amb.foreignBox, user.address, '21300', foreignBox.methods.value().encodeABI()]
      )

      await makeAsyncCall(selector, data3)

      assert(!(await homeBox.methods.status().call()), 'status is true')
      assert.strictEqual(await homeBox.methods.data().call(), null, 'returned data is incorrect')
    })

    it('should make async eth_call for specific block', async () => {
      const foreignValue = await foreignBox.methods.value().call()
      const blockNumber = await foreignWeb3.eth.getBlockNumber()
      const selector = homeWeb3.utils.soliditySha3('eth_call(address,bytes,uint256)')
      const data1 = homeWeb3.eth.abi.encodeParameters(
        ['address', 'bytes', 'uint256'],
        [amb.foreignBox, foreignBox.methods.value().encodeABI(), 60]
      )
      const data2 = homeWeb3.eth.abi.encodeParameters(
        ['address', 'bytes', 'uint256'],
        [amb.foreignBox, foreignBox.methods.value().encodeABI(), blockNumber - 2]
      )
      const data3 = homeWeb3.eth.abi.encodeParameters(
        ['address', 'bytes', 'uint256'],
        [amb.foreignBox, foreignBox.methods.value().encodeABI(), blockNumber + 20]
      )

      await makeAsyncCall(selector, data1)

      assert(await homeBox.methods.status().call(), 'status is false')
      assert.strictEqual(
        await homeBox.methods.data().call(),
        homeWeb3.eth.abi.encodeParameters(['bytes'], [homeWeb3.eth.abi.encodeParameter('uint256', 0)]),
        'returned data is incorrect'
      )

      await makeAsyncCall(selector, data2)

      assert(await homeBox.methods.status().call(), 'status is false')
      assert.strictEqual(
        await homeBox.methods.data().call(),
        homeWeb3.eth.abi.encodeParameters(['bytes'], [homeWeb3.eth.abi.encodeParameter('uint256', foreignValue)]),
        'returned data is incorrect'
      )

      await makeAsyncCall(selector, data3)

      assert(!(await homeBox.methods.status().call()), 'status is true')
    })

    it('should make async eth_blockNumber', async () => {
      const selector = homeWeb3.utils.soliditySha3('eth_blockNumber()')

      await makeAsyncCall(selector, '0x')

      assert(await homeBox.methods.status().call(), 'status is false')
      assert.strictEqual((await homeBox.methods.data().call()).length, 66, 'invalid block number')
    })

    it('should make async eth_getBlockByNumber', async () => {
      const blockNumber = ((await foreignWeb3.eth.getBlockNumber()) - 5).toString()
      const selector = homeWeb3.utils.soliditySha3('eth_getBlockByNumber(uint256)')

      await makeAsyncCall(selector, homeWeb3.eth.abi.encodeParameter('uint256', blockNumber))

      assert(await homeBox.methods.status().call(), 'status is false')
      const data = await homeBox.methods.data().call()
      assert.strictEqual(data.length, 2 + 64 * 3)
      const { 0: number, 1: hash, 2: miner } = homeWeb3.eth.abi.decodeParameters(
        ['uint256', 'bytes32', 'address'],
        data
      )
      const block = await foreignWeb3.eth.getBlock(blockNumber)
      assert.strictEqual(number, blockNumber, 'wrong block number returned')
      assert.strictEqual(hash, block.hash, 'wrong block hash returned')
      assert.strictEqual(miner, block.miner, 'wrong block miner returned')
    })

    it('should make async eth_getBlockByNumber and return latest block', async () => {
      const selector = homeWeb3.utils.soliditySha3('eth_getBlockByNumber()')

      await makeAsyncCall(selector, '0x')

      assert(await homeBox.methods.status().call(), 'status is false')
      const data = await homeBox.methods.data().call()
      assert.strictEqual(data.length, 2 + 64 * 3)
    })

    it('should make async eth_getBlockByHash', async () => {
      const blockNumber = ((await foreignWeb3.eth.getBlockNumber()) - 5).toString()
      const block = await foreignWeb3.eth.getBlock(blockNumber)
      const selector = homeWeb3.utils.soliditySha3('eth_getBlockByHash(bytes32)')

      await makeAsyncCall(selector, block.hash)

      assert(await homeBox.methods.status().call(), 'status is false')
      const data = await homeBox.methods.data().call()
      assert.strictEqual(data.length, 2 + 64 * 3)

      const { 0: number, 1: hash, 2: miner } = homeWeb3.eth.abi.decodeParameters(
        ['uint256', 'bytes32', 'address'],
        data
      )

      assert.strictEqual(number, blockNumber, 'wrong block number returned')
      assert.strictEqual(hash, block.hash, 'wrong block hash returned')
      assert.strictEqual(miner, block.miner, 'wrong block miner returned')
    })

    it('should make async eth_getBalance', async () => {
      const balance = await foreignWeb3.eth.getBalance(user.address)
      const selector = homeWeb3.utils.soliditySha3('eth_getBalance(address)')

      await makeAsyncCall(selector, homeWeb3.eth.abi.encodeParameter('address', user.address))

      assert(await homeBox.methods.status().call(), 'status is false')
      const data = await homeBox.methods.data().call()
      assert.strictEqual(data.length, 2 + 64)

      assert.strictEqual(homeWeb3.eth.abi.decodeParameter('uint256', data), balance, 'wrong user balance returned')
    })

    it('should make async eth_getBalance for specific block', async () => {
      const balance = await foreignWeb3.eth.getBalance(user.address)
      const { blockNumber } = await foreignWeb3.eth.sendTransaction({
        to: user.address,
        value: 1,
        from: user.address,
        gas: 21000
      })
      const selector = homeWeb3.utils.soliditySha3('eth_getBalance(address,uint256)')

      const data1 = homeWeb3.eth.abi.encodeParameters(['address', 'uint256'], [user.address, blockNumber - 1])
      const data2 = homeWeb3.eth.abi.encodeParameters(['address', 'uint256'], [user.address, blockNumber])
      await makeAsyncCall(selector, data1)

      assert(await homeBox.methods.status().call(), 'status is false')
      let data = await homeBox.methods.data().call()
      assert.strictEqual(data.length, 2 + 64)

      assert.strictEqual(homeWeb3.eth.abi.decodeParameter('uint256', data), balance, 'wrong user balance returned')

      await makeAsyncCall(selector, data2)

      assert(await homeBox.methods.status().call(), 'status is false')
      data = await homeBox.methods.data().call()
      assert.strictEqual(data.length, 2 + 64)

      assert.notStrictEqual(homeWeb3.eth.abi.decodeParameter('uint256', data), balance, 'wrong user balance returned')
    })

    it('should make async eth_getTransactionCount', async () => {
      const nonce = (await foreignWeb3.eth.getTransactionCount(user.address)).toString()
      const selector = homeWeb3.utils.soliditySha3('eth_getTransactionCount(address)')

      await makeAsyncCall(selector, homeWeb3.eth.abi.encodeParameter('address', user.address))

      assert(await homeBox.methods.status().call(), 'status is false')
      const data = await homeBox.methods.data().call()
      assert.strictEqual(data.length, 2 + 64)

      assert.strictEqual(homeWeb3.eth.abi.decodeParameter('uint256', data), nonce, 'wrong user nonce returned')
    })

    it('should make async eth_getTransactionCount for specific block', async () => {
      let nonce = (await foreignWeb3.eth.getTransactionCount(user.address)).toString()
      const { blockNumber } = await foreignWeb3.eth.sendTransaction({
        to: user.address,
        value: 1,
        from: user.address,
        gas: 21000
      })
      const selector = homeWeb3.utils.soliditySha3('eth_getTransactionCount(address,uint256)')

      const data1 = homeWeb3.eth.abi.encodeParameters(['address', 'uint256'], [user.address, blockNumber - 1])
      const data2 = homeWeb3.eth.abi.encodeParameters(['address', 'uint256'], [user.address, blockNumber])

      await makeAsyncCall(selector, data1)
      assert(await homeBox.methods.status().call(), 'status is false')
      let data = await homeBox.methods.data().call()
      assert.strictEqual(data.length, 2 + 64)

      assert.strictEqual(homeWeb3.eth.abi.decodeParameter('uint256', data), nonce, 'wrong user nonce returned')

      await makeAsyncCall(selector, data2)
      assert(await homeBox.methods.status().call(), 'status is false')
      data = await homeBox.methods.data().call()
      assert.strictEqual(data.length, 2 + 64)

      nonce = (parseInt(nonce, 10) + 1).toString()
      assert.strictEqual(homeWeb3.eth.abi.decodeParameter('uint256', data), nonce, 'wrong user nonce returned')
    })

    it('should make async eth_getTransactionByHash', async () => {
      const txHash = '0x09dfb947dbd17e27bcc117773b6e133829f7cef9646199a93ef019c4f7c0fec6'
      const tx = await foreignWeb3.eth.getTransaction(txHash)
      const selector = homeWeb3.utils.soliditySha3('eth_getTransactionByHash(bytes32)')

      await makeAsyncCall(selector, txHash)

      assert(await homeBox.methods.status().call(), 'status is false')
      const data = await homeBox.methods.data().call()
      const dataTypes = [
        'bytes32',
        'uint256',
        'address',
        'address',
        'uint256',
        'uint256',
        'uint256',
        'uint256',
        'bytes'
      ]
      const values = homeWeb3.eth.abi.decodeParameters(dataTypes, data)

      assert.strictEqual(values[0], txHash, 'wrong txHash returned')
      assert.strictEqual(values[1], tx.blockNumber.toString(), 'wrong tx blockNumber returned')
      assert.strictEqual(values[2], tx.from, 'wrong tx from returned')
      assert.strictEqual(values[3], tx.to, 'wrong tx to returned')
      assert.strictEqual(values[4], tx.value, 'wrong tx value returned')
      assert.strictEqual(values[5], tx.nonce.toString(), 'wrong tx nonce returned')
      assert.strictEqual(values[6], tx.gas.toString(), 'wrong tx gas returned')
      assert.strictEqual(values[7], tx.gasPrice, 'wrong tx gasPrice returned')
      assert.strictEqual(values[8], tx.input, 'wrong tx data returned')
    })

    it('should make async eth_getTransactionReceipt', async () => {
      const txHash = '0x09dfb947dbd17e27bcc117773b6e133829f7cef9646199a93ef019c4f7c0fec6'
      const receipt = await foreignWeb3.eth.getTransactionReceipt(txHash)
      const selector = homeWeb3.utils.soliditySha3('eth_getTransactionReceipt(bytes32)')

      await makeAsyncCall(selector, txHash)

      assert(await homeBox.methods.status().call(), 'status is false')
      const data = await homeBox.methods.data().call()
      const dataTypes = ['bytes32', 'uint256', 'bool', '(address,bytes32[],bytes)[]']
      const values = homeWeb3.eth.abi.decodeParameters(dataTypes, data)

      assert.strictEqual(values[0], txHash, 'wrong txHash returned')
      assert.strictEqual(values[1], receipt.blockNumber.toString(), 'wrong tx blockNumber returned')
      assert.strictEqual(values[2], receipt.status, 'wrong tx status returned')
      assert.strictEqual(values[3].length, 1, 'wrong logs length returned')
      assert.strictEqual(values[3][0][0], receipt.logs[0].address, 'wrong log address returned')
      assert.strictEqual(values[3][0][1].length, 2, 'wrong log topics length returned')
      assert.strictEqual(values[3][0][1][0], receipt.logs[0].topics[0], 'wrong event signature returned')
      assert.strictEqual(values[3][0][1][1], receipt.logs[0].topics[1], 'wrong message id returned')
      assert.strictEqual(values[3][0][2], receipt.logs[0].data, 'wrong log data returned')
    })

    it('should make async eth_getStorageAt', async () => {
      // slot for uintStorage[MAX_GAS_PER_TX]
      const slot = '0x3d7fe2ee9790702383ef0118b516833ef2542132d3ca4ac6c77f62f1230fa610'
      const value = await foreignWeb3.eth.getStorageAt(amb.foreign, slot)
      const selector = homeWeb3.utils.soliditySha3('eth_getStorageAt(address,bytes32)')

      await makeAsyncCall(selector, homeWeb3.eth.abi.encodeParameters(['address', 'bytes32'], [amb.foreign, slot]))

      assert(await homeBox.methods.status().call(), 'status is false')
      const data = await homeBox.methods.data().call()

      assert.strictEqual(data, value, 'wrong storage value returned')
    })

    it('should make async eth_getStorageAt for specific block', async () => {
      // slot for uintStorage[MAX_GAS_PER_TX]
      const slot = '0x3d7fe2ee9790702383ef0118b516833ef2542132d3ca4ac6c77f62f1230fa610'
      const value = await foreignWeb3.eth.getStorageAt(amb.foreign, slot)
      const blockNumber = await foreignWeb3.eth.getBlockNumber()
      const selector = homeWeb3.utils.soliditySha3('eth_getStorageAt(address,bytes32,uint256)')

      const data1 = homeWeb3.eth.abi.encodeParameters(
        ['address', 'bytes32', 'uint256'],
        [amb.foreign, slot, blockNumber]
      )
      const data2 = homeWeb3.eth.abi.encodeParameters(['address', 'bytes32', 'uint256'], [amb.foreign, slot, 1])

      await makeAsyncCall(selector, data1)
      assert(await homeBox.methods.status().call(), 'status is false')
      let data = await homeBox.methods.data().call()

      assert.strictEqual(data, value, 'wrong storage value returned')

      await makeAsyncCall(selector, data2)
      assert(await homeBox.methods.status().call(), 'status is false')
      data = await homeBox.methods.data().call()

      assert.strictEqual(
        data,
        '0x0000000000000000000000000000000000000000000000000000000000000000',
        'wrong storage value returned'
      )
    })
  })
})
