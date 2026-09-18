 module.exports = {
  // The simulator can reach localhost. Real devices and releases need an HTTPS API domain.
  apiBaseUrl: "http://127.0.0.1:5180",
  merchantAccount: "club001",
  // Never silently replace merchant data with demo data when the API fails.
  allowPreviewFallback: false
};
