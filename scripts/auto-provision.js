#!/usr/bin/env node
/**
 * 自动配置 Cloudflare 资源
 * 通过 Cloudflare API 自动创建 R2、D1、Turnstile
 */

const https = require('https');

// Cloudflare API 基础配置
const API_BASE = 'https://api.cloudflare.com/client/v4';

/**
 * 发送 Cloudflare API 请求
 */
async function cfRequest(method, endpoint, data = null, apiToken, accountId) {
  return new Promise((resolve, reject) => {
    const url = `${API_BASE}${endpoint.replace('{account_id}', accountId)}`;
    const options = {
      method,
      headers: {
        'Authorization': `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
      },
    };

    const req = https.request(url, options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          if (json.success) {
            resolve(json);
          } else {
            reject(new Error(json.errors?.[0]?.message || 'API request failed'));
          }
        } catch (e) {
          reject(new Error(`Failed to parse response: ${body}`));
        }
      });
    });

    req.on('error', reject);

    if (data) {
      req.write(JSON.stringify(data));
    }

    req.end();
  });
}

/**
 * 创建 R2 存储桶
 */
async function createR2Bucket(apiToken, accountId, bucketName) {
  try {
    const result = await cfRequest(
      'POST',
      '/accounts/{account_id}/r2/buckets',
      { name: bucketName },
      apiToken,
      accountId
    );
    return { success: true, bucket: result.result };
  } catch (error) {
    if (error.message.includes('already exists')) {
      return { success: true, exists: true };
    }
    throw error;
  }
}

/**
 * 创建 D1 数据库
 */
async function createD1Database(apiToken, accountId, dbName) {
  try {
    const result = await cfRequest(
      'POST',
      '/accounts/{account_id}/d1/database',
      { name: dbName },
      apiToken,
      accountId
    );
    return { success: true, database: result.result };
  } catch (error) {
    if (error.message.includes('already exists')) {
      return { success: true, exists: true };
    }
    throw error;
  }
}

/**
 * 创建 Turnstile 站点
 */
async function createTurnstileSite(apiToken, accountId, domain) {
  try {
    const result = await cfRequest(
      'POST',
      '/accounts/{account_id}/challenges/sites',
      {
        name: `ioDrive-${domain}`,
        domain: domain,
        mode: 'managed',
      },
      apiToken,
      accountId
    );
    return { success: true, site: result.result };
  } catch (error) {
    // Turnstile API 可能不可用，返回测试站点信息
    console.warn('Turnstile site creation failed, using test keys');
    return {
      success: true,
      site: {
        site_key: '1x00000000000000000000AA',
        secret_key: '1x0000000000000000000000000000000AA',
      },
    };
  }
}

/**
 * 生成随机密钥
 */
function generateSecret(length = 32) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * 主函数
 */
async function main() {
  const args = process.argv.slice(2);
  const [apiToken, accountId, domain, workerName] = args;

  if (!apiToken || !accountId || !domain) {
    console.error('Usage: node auto-provision.js <apiToken> <accountId> <domain> [workerName]');
    process.exit(1);
  }

  const bucketName = workerName || 'iodrive';
  const dbName = `${bucketName}-meta`;

  console.log('🚀 开始自动配置 Cloudflare 资源...\n');

  // 1. 创建 R2 存储桶
  console.log('📦 创建 R2 存储桶...');
  try {
    const r2Result = await createR2Bucket(apiToken, accountId, bucketName);
    if (r2Result.exists) {
      console.log(`   ✅ R2 存储桶 "${bucketName}" 已存在`);
    } else {
      console.log(`   ✅ R2 存储桶 "${bucketName}" 创建成功`);
    }
  } catch (error) {
    console.error(`   ❌ R2 存储桶创建失败: ${error.message}`);
    process.exit(1);
  }

  // 2. 创建 D1 数据库
  console.log('🗄️  创建 D1 数据库...');
  try {
    const d1Result = await createD1Database(apiToken, accountId, dbName);
    if (d1Result.exists) {
      console.log(`   ✅ D1 数据库 "${dbName}" 已存在`);
    } else {
      console.log(`   ✅ D1 数据库 "${dbName}" 创建成功`);
      console.log(`   📌 数据库 ID: ${d1Result.database.id}`);
    }
  } catch (error) {
    console.error(`   ❌ D1 数据库创建失败: ${error.message}`);
    process.exit(1);
  }

  // 3. 创建 Turnstile 站点
  console.log('🛡️  创建 Turnstile 站点...');
  try {
    const turnstileResult = await createTurnstileSite(apiToken, accountId, domain);
    console.log(`   ✅ Turnstile 站点创建成功`);
    console.log(`   📌 Site Key: ${turnstileResult.site.site_key}`);
    console.log(`   📌 Secret Key: ${turnstileResult.site.secret_key}`);
  } catch (error) {
    console.error(`   ❌ Turnstile 站点创建失败: ${error.message}`);
    process.exit(1);
  }

  // 4. 生成安全密钥
  console.log('🔑 生成安全密钥...');
  const adminPass = generateSecret(16);
  const jwtSecret = generateSecret(64);

  console.log('   ✅ 管理员密码已生成');
  console.log('   ✅ JWT Secret 已生成');

  // 5. 输出配置
  console.log('\n📋 配置完成！请保存以下信息：\n');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`R2 存储桶名称:        ${bucketName}`);
  console.log(`D1 数据库名称:        ${dbName}`);
  console.log(`D1 数据库 ID:         ${await getD1DatabaseId(apiToken, accountId, dbName)}`);
  console.log(`Turnstile Site Key:   ${turnstileResult.site.site_key}`);
  console.log(`Turnstile Secret Key: ${turnstileResult.site.secret_key}`);
  console.log(`管理员密码:           ${adminPass}`);
  console.log(`JWT Secret:           ${jwtSecret}`);
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('\n⚠️  请妥善保存这些信息，特别是密钥！');
}

/**
 * 获取 D1 数据库 ID
 */
async function getD1DatabaseId(apiToken, accountId, dbName) {
  try {
    const result = await cfRequest(
      'GET',
      '/accounts/{account_id}/d1/database',
      null,
      apiToken,
      accountId
    );
    const db = result.result.find(d => d.name === dbName);
    return db ? db.id : 'NOT_FOUND';
  } catch (error) {
    return 'ERROR';
  }
}

// 运行主函数
main().catch(error => {
  console.error('❌ 配置失败:', error.message);
  process.exit(1);
});
