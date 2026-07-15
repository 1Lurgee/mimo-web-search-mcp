#!/usr/bin/env node
/**
 * 测试工具模块
 * 提供测试框架和断言函数
 */

// 测试计数器
let passed = 0;
let failed = 0;
let total = 0;
const results = [];

/**
 * 运行单个测试
 * @param {string} name - 测试名称
 * @param {Function} fn - 测试函数
 */
export function test(name, fn) {
  total++;
  try {
    const result = fn();
    if (result instanceof Promise) {
      return result
        .then(() => {
          passed++;
          results.push({ name, status: "PASS" });
          console.log(`  ✅ ${name}`);
        })
        .catch((err) => {
          failed++;
          results.push({ name, status: "FAIL", error: err.message });
          console.log(`  ❌ ${name}: ${err.message}`);
        });
    }
    passed++;
    results.push({ name, status: "PASS" });
    console.log(`  ✅ ${name}`);
  } catch (err) {
    failed++;
    results.push({ name, status: "FAIL", error: err.message });
    console.log(`  ❌ ${name}: ${err.message}`);
  }
}

/**
 * 断言条件为真
 * @param {boolean} condition - 条件
 * @param {string} message - 错误消息
 */
export function assert(condition, message) {
  if (!condition) {
    throw new Error(message || "Assertion failed");
  }
}

/**
 * 断言两个值相等
 * @param {*} actual - 实际值
 * @param {*} expected - 期望值
 * @param {string} message - 错误消息
 */
export function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(message || `Expected ${expected}, got ${actual}`);
  }
}

/**
 * 断言字符串包含子串
 * @param {string} str - 字符串
 * @param {string} substr - 子串
 * @param {string} message - 错误消息
 */
export function assertContains(str, substr, message) {
  if (!str.includes(substr)) {
    throw new Error(message || `Expected "${str}" to contain "${substr}"`);
  }
}

/**
 * 断言函数抛出错误
 * @param {Function} fn - 函数
 * @param {string} expectedError - 期望的错误消息（可选）
 * @param {string} message - 错误消息
 */
export function assertThrows(fn, expectedError, message) {
  try {
    fn();
    throw new Error(message || "Expected function to throw");
  } catch (err) {
    if (expectedError && !err.message.includes(expectedError)) {
      throw new Error(message || `Expected error containing "${expectedError}", got "${err.message}"`);
    }
  }
}

/**
 * 打印测试套件标题
 * @param {string} title - 标题
 */
export function suite(title) {
  console.log(`\n📦 ${title}`);
}

/**
 * 打印测试结果并返回退出码
 * @returns {number} 退出码（0=成功，1=失败）
 */
export function printResults() {
  console.log("\n" + "=".repeat(50));
  console.log(`\n📊 测试结果: ${passed}/${total} 通过`);
  if (failed > 0) {
    console.log(`❌ ${failed} 个测试失败`);
    return 1;
  } else {
    console.log("✅ 所有测试通过!");
    return 0;
  }
}

/**
 * 获取测试统计
 * @returns {{ passed: number, failed: number, total: number }}
 */
export function getStats() {
  return { passed, failed, total };
}

/**
 * 重置测试计数器
 */
export function reset() {
  passed = 0;
  failed = 0;
  total = 0;
  results.length = 0;
}
