 module.exports = {
  // The simulator can reach localhost. Real devices and releases need an HTTPS API domain.
  apiBaseUrl: "http://127.0.0.1:5180",
  merchantAccount: "club001"
  // 已移除本地兜底/示例配置：接口取不到商户数据时一律报错，不使用假数据。
};
