// mobile/metro.config.js
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '..'); // 레포 루트 (26s-w2-c3-03)

const config = getDefaultConfig(projectRoot);

// mobile 폴더 밖(shared 등)도 감시 대상에 포함시키기
config.watchFolders = [workspaceRoot];

// node_modules도 루트 기준으로 찾을 수 있게 (혹시 모를 문제 방지)
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

module.exports = config;