#!/usr/bin/env node
const https = require('https');

const RENDER_API_KEY = process.env.RENDER_API_KEY || '';
const SERVICE_ID = process.env.RENDER_SERVICE_ID || 'srv-d9ojhdcs728c73f9qr4g';

function renderRequest(path, method = 'GET', data = null) {
  return new Promise((resolve, reject) => {
    const payload = data ? JSON.stringify(data) : null;
    const req = https.request(
      `https://api.render.com/v1${path}`,
      {
        method,
        headers: {
          Authorization: `Bearer ${RENDER_API_KEY}`,
          Accept: 'application/json',
          ...(payload
            ? {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload),
              }
            : {}),
        },
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, data: JSON.parse(body) });
          } catch (e) {
            resolve({ status: res.statusCode, raw: body });
          }
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function getStatus() {
  console.log(`[Render] Checking service ${SERVICE_ID}...`);
  const sRes = await renderRequest(`/services/${SERVICE_ID}`);
  if (sRes.status !== 200) {
    console.error('Error fetching service:', sRes);
    return;
  }
  const s = sRes.data;
  console.log(`Service Name: ${s.name}`);
  console.log(`Live URL:     ${s.serviceDetails?.url || 'N/A'}`);
  console.log(`Repo:         ${s.repo}`);
  console.log(`Updated At:   ${s.updatedAt}`);

  const depRes = await renderRequest(`/services/${SERVICE_ID}/deploys?limit=3`);
  if (Array.isArray(depRes.data)) {
    console.log('\nLatest Deploys:');
    for (const item of depRes.data) {
      const d = item.deploy;
      console.log(` - [${d.status.toUpperCase()}] ID: ${d.id} | Commit: ${d.commit?.id?.slice(0, 7)} ("${d.commit?.message?.slice(0, 45)}...") | Finished: ${d.finishedAt || 'In Progress'}`);
    }
  }
}

async function triggerDeploy(clearCache = false) {
  console.log(`[Render] Triggering new deployment (clearCache=${clearCache})...`);
  const res = await renderRequest(`/services/${SERVICE_ID}/deploys`, 'POST', {
    clearCache: clearCache ? 'clear' : 'do_not_clear',
  });
  if (res.status === 201 || res.status === 200) {
    console.log(`✅ Deploy triggered successfully! Deploy ID: ${res.data.id}, Status: ${res.data.status}`);
  } else {
    console.error('❌ Failed to trigger deploy:', res);
  }
}

async function restartService() {
  console.log(`[Render] Restarting service ${SERVICE_ID}...`);
  const res = await renderRequest(`/services/${SERVICE_ID}/restart`, 'POST');
  if (res.status === 200) {
    console.log('✅ Service restart triggered successfully!');
  } else {
    console.error('❌ Failed to restart service:', res);
  }
}

async function main() {
  const action = process.argv[2] || 'status';
  if (action === 'status') {
    await getStatus();
  } else if (action === 'deploy') {
    const clearCache = process.argv.includes('--clear-cache');
    await triggerDeploy(clearCache);
  } else if (action === 'restart') {
    await restartService();
  } else {
    console.log('Usage: node render_control.js [status|deploy|restart] [--clear-cache]');
  }
}

main().catch(console.error);
