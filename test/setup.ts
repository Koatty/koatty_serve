// test/setup.ts - Jest测试环境设置
// 增加进程事件监听器限制
process.setMaxListeners(0);

// 🔧 使用 Jest 假定时器避免真实定时器的资源泄漏
jest.useFakeTimers({
  advanceTimers: true,
  doNotFake: ['nextTick', 'setImmediate', 'clearImmediate']
});

// 在每个测试前设置假定时器
beforeEach(() => {
  jest.clearAllTimers();
  jest.clearAllMocks();
});

// 在每个测试后清理定时器和事件监听器
afterEach(() => {
  // 清理所有定时器
  jest.clearAllTimers();
  jest.clearAllMocks();
  
  // 给异步操作一些时间完成
  return new Promise(resolve => setTimeout(resolve, 10));
});

// 在每个测试套件后确保资源清理
afterAll(async () => {
  // 恢复真实定时器
  jest.useRealTimers();
  // 等待所有异步操作完成
  await new Promise(resolve => setTimeout(resolve, 100));
}); 