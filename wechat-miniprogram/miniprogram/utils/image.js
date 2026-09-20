const fs = wx.getFileSystemManager();

function stableKey(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function materializeDataUrl(source) {
  if (!/^data:image\//i.test(source || "")) return Promise.resolve(source || "");
  const match = String(source).match(/^data:image\/(png|jpe?g|webp);base64,(.+)$/i);
  if (!match) return Promise.resolve("");
  const ext = match[1].toLowerCase().replace("jpeg", "jpg");
  const filePath = `${wx.env.USER_DATA_PATH}/club-${stableKey(source.slice(0, 2048))}.${ext}`;
  return new Promise((resolve) => {
    fs.access({
      path: filePath,
      success: () => resolve(filePath),
      fail: () => fs.writeFile({
        filePath,
        data: match[2],
        encoding: "base64",
        success: () => resolve(filePath),
        fail: () => resolve("")
      })
    });
  });
}

function resolveAssetUrl(source, apiBaseUrl) {
  const value = String(source || "");
  if (!value.startsWith("/") || value.startsWith("//")) return value;
  return `${String(apiBaseUrl || "").replace(/\/$/, "")}${value}`;
}

async function prepareImage(source, apiBaseUrl) {
  const materialized = await materializeDataUrl(source);
  return resolveAssetUrl(materialized, apiBaseUrl);
}

async function prepareConfigImages(input, apiBaseUrl = "") {
  const config = JSON.parse(JSON.stringify(input || {}));
  config.heroImageUrl = await prepareImage(config.heroImageUrl, apiBaseUrl);
  if (Array.isArray(config.products)) {
    config.products = await Promise.all(config.products.map(async (item) => ({
      ...item,
      imageUrl: await prepareImage(item.imageUrl, apiBaseUrl)
    })));
  }
  if (Array.isArray(config.categoryTree)) {
    config.categoryTree = await Promise.all(config.categoryTree.map(async (item) => ({
      ...item,
      imageUrl: await prepareImage(item.imageUrl, apiBaseUrl)
    })));
  }
  if (config.quickActions && typeof config.quickActions === "object") {
    for (const item of Object.values(config.quickActions)) {
      if (item && typeof item === "object") item.imageUrl = await prepareImage(item.imageUrl, apiBaseUrl);
    }
  }
  return config;
}

module.exports = { materializeDataUrl, prepareConfigImages, resolveAssetUrl };
