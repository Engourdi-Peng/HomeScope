/**
 * 生成 Chrome 扩展图标
 * 从 public/logo.svg 生成多尺寸 PNG 图标
 *
 * 使用方法：
 * node scripts/generate-icons.js
 */

import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

// 简单的 SVG 转 PNG 实现（使用 Canvas）
// 注意：这需要安装 sharp 包：npm install sharp

export async function generateIcons() {
  try {
    // 动态导入 sharp（需要先安装）
    const sharp = (await import('sharp')).default;

    const svgPath = join(process.cwd(), 'public', 'logo.svg');
    const svgBuffer = readFileSync(svgPath);

    const sizes = [16, 48, 128, 512];
    const outputDir = join(process.cwd(), 'extension');

    console.log('Generating icons...');

    for (const size of sizes) {
      const outputPath = join(outputDir, `icon-${size}.png`);

      await sharp(svgBuffer)
        .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toFile(outputPath);

      console.log(`✅ Generated icon-${size}.png`);
    }

    // 同时生成一个统一的 icon.png（使用 512 尺寸）
    await sharp(svgBuffer)
      .resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toFile(join(outputDir, 'icon.png'));

    console.log('✅ Generated icon.png');

    console.log('\n✨ All icons generated successfully!');
  } catch (err) {
    console.error('❌ Error generating icons:', err.message);
    console.log('\nAlternative: Use online converter:');
    console.log('https://cloudconvert.com/svg-to-png');
    console.log('https://www.icoconverter.com/');
    process.exit(1);
  }
}

generateIcons();
