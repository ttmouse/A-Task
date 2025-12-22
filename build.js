const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

// 确保 dist 目录存在
if (!fs.existsSync('dist')) {
  fs.mkdirSync('dist');
}

// 构建配置
const buildOptions = {
  entryPoints: [
    'src/background.ts',
    'src/content-gemini.ts',
    'src/sidepanel/sidepanel.ts'
  ],
  bundle: true,
  outdir: 'dist',
  format: 'iife', // 使用 IIFE 格式，适合浏览器环境
  platform: 'browser',
  target: 'es2020',
  sourcemap: false,
  minify: false,
  treeShaking: true
};

async function build() {
  try {
    // AIDEV-NOTE: 构建 Service Worker (background) - 必须使用 ESM 格式
    // manifest.json 中 background.type = "module" 要求使用 ESM
    console.log('📦 构建 Service Worker (ESM)...');
    await esbuild.build({
      entryPoints: ['src/background.ts'],
      bundle: true,
      outfile: 'dist/background.js',
      format: 'esm',  // Service Worker 需要 ESM
      platform: 'browser',
      target: 'es2020',
      sourcemap: true
    });

    // AIDEV-NOTE: 构建 Content Scripts - 必须使用 IIFE 格式
    // Content Scripts 不支持 ES6 模块，需要打包成 IIFE
    console.log('📦 构建 Content Scripts (IIFE)...');
    await esbuild.build({
      entryPoints: ['src/content-gemini.ts'],
      bundle: true,
      outfile: 'dist/content-gemini.js',
      format: 'iife',  // Content Scripts 需要 IIFE
      platform: 'browser',
      target: 'es2020',
      sourcemap: true
    });

    // AIDEV-NOTE: 构建 Side Panel - 使用 ESM 格式
    // HTML 中 script 标签有 type="module"，可以使用 ESM
    console.log('📦 构建 Side Panel (ESM)...');
    await esbuild.build({
      entryPoints: ['src/sidepanel/sidepanel.ts'],
      bundle: true,
      outfile: 'dist/sidepanel/sidepanel.js',
      format: 'esm',
      platform: 'browser',
      target: 'es2020',
      sourcemap: true
    });

    console.log('✅ 构建成功！');

    // 复制静态文件
    const copyFiles = [
      { from: 'src/manifest.json', to: 'dist/manifest.json' },
      { from: 'src/sidepanel/sidepanel.html', to: 'dist/sidepanel/sidepanel.html' },
      { from: 'src/sidepanel/sidepanel.css', to: 'dist/sidepanel/sidepanel.css' }
    ];

    // 确保 sidepanel 目录存在
    if (!fs.existsSync('dist/sidepanel')) {
      fs.mkdirSync('dist/sidepanel', { recursive: true });
    }

    // 确保 icons 目录存在
    if (!fs.existsSync('dist/icons')) {
      fs.mkdirSync('dist/icons', { recursive: true });
    }

    copyFiles.forEach(({ from, to }) => {
      if (fs.existsSync(from)) {
        fs.copyFileSync(from, to);
      }
    });

    // 复制 icons 目录
    if (fs.existsSync('src/icons')) {
      const icons = fs.readdirSync('src/icons');
      icons.forEach(icon => {
        fs.copyFileSync(`src/icons/${icon}`, `dist/icons/${icon}`);
      });
    }

    console.log('✅ 静态文件复制完成！');
  } catch (error) {
    console.error('❌ 构建失败:', error);
    process.exit(1);
  }
}

build();
