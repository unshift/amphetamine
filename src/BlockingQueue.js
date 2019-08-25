// lifted from: https://github.com/yarnpkg/yarn/blob/master/src/util/blocking-queue.js

module.exports = class BlockingQueue {
  constructor (alias, maxConcurrency = Infinity) {
    this.concurrencyQueue = []
    this.maxConcurrency = maxConcurrency
    this.runningCount = 0
    this.warnedStuck = false
    this.alias = alias
    this.first = true

    this.running = []
    this.queue = []

    this.stuckTick = this.stuckTick.bind(this)
  }

  stillActive () {
    if (this.stuckTimer) {
      clearTimeout(this.stuckTimer)
    }

    this.stuckTimer = setTimeout(this.stuckTick, 5000)

    // We need to check the existence of unref because of https://github.com/facebook/jest/issues/4559
    // $FlowFixMe: Node's setInterval returns a Timeout, not a Number
    this.stuckTimer.unref && this.stuckTimer.unref()
  }

  stuckTick () {
    if (this.runningCount === 1) {
      this.warnedStuck = true
      console.log(
        `The ${JSON.stringify(this.alias)} blocking queue may be stuck. 5 seconds ` +
          `without any activity with 1 worker: ${Object.keys(this.running)[0]}`,
      )
    }
  }

  push (key, factory) {
    if (this.first) {
      this.first = false
    } else {
      this.stillActive()
    }

    return new Promise((resolve, reject) => {
      // we're already running so push ourselves to the queue
      const queue = (this.queue[key] = this.queue[key] || [])
      queue.push({factory, resolve, reject})

      if (!this.running[key]) {
        this.shift(key)
      }
    })
  }

  shift (key) {
    if (this.running[key]) {
      delete this.running[key]
      this.runningCount--

      if (this.stuckTimer) {
        clearTimeout(this.stuckTimer)
        this.stuckTimer = null
      }

      if (this.warnedStuck) {
        this.warnedStuck = false
        debug(`${JSON.stringify(this.alias)} blocking queue finally resolved. Nothing to worry about.`)
      }
    }

    const queue = this.queue[key]
    if (!queue) {
      return
    }

    const {resolve, reject, factory} = queue.shift()
    if (!queue.length) {
      delete this.queue[key]
    }

    const next = () => {
      this.shift(key)
      this.shiftConcurrencyQueue()
    }

    const run = () => {
      this.running[key] = true
      this.runningCount++

      factory()
        .then(function(val) {
          resolve(val)
          next()
          return null
        })
        .catch(function(err) {
          reject(err)
          next()
        })
    }

    this.maybePushConcurrencyQueue(run)
  }

  maybePushConcurrencyQueue (run) {
    if (this.runningCount < this.maxConcurrency) {
      run()
    } else {
      this.concurrencyQueue.push(run)
    }
  }

  shiftConcurrencyQueue () {
    if (this.runningCount < this.maxConcurrency) {
      const fn = this.concurrencyQueue.shift()
      if (fn) {
        fn()
      }
    }
  }
}