/**
 * GraphQL 服务器日志格式测试
 * 
 * 验证 GraphQL 服务器日志正确显示：
 * - [HTTP] [GRAPHQL] - 底层协议和实际协议
 * - Server: GRAPHQL running at http://... - 使用底层协议的 URL
 */

const { NewServe } = require('../dist/index.js');

class MockApp {
  config() { return null; }
  once() {}
  on() {}
  use() {}
}

console.log('\n========================================');
console.log('GraphQL 服务器日志格式测试');
console.log('========================================\n');

// 测试 1: GraphQL without SSL (使用 HTTP)
console.log('测试 1: GraphQL 服务器（无 SSL，底层使用 HTTP）\n');

const app1 = new MockApp();
const graphqlServer = NewServe(app1, {
  hostname: '127.0.0.1',
  port: 33001,
  protocol: 'graphql',
  ext: {
    schemaFile: './test-schema.graphql'
  }
});

console.log('期望的日志格式：');
console.log('  [HTTP] [GRAPHQL] graphql server constructed');
console.log('  [HTTP] [GRAPHQL] Server: GRAPHQL running at http://127.0.0.1:33001/\n');

graphqlServer.Start(() => {
  console.log('✅ GraphQL 服务器已启动');
  console.log('请检查上方日志是否符合期望格式\n');
  
  setTimeout(() => {
    graphqlServer.Stop().then(() => {
      console.log('✅ 测试完成\n');
      console.log('========================================\n');
      process.exit(0);
    }).catch(err => {
      console.error('❌ 停止服务器失败:', err);
      process.exit(1);
    });
  }, 500);
});

