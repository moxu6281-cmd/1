// 真实支付工具：调起微信支付，并向服务端确认到账。
// 关键原则：wx.requestPayment 的 success 只代表"用户在微信里付了"，
// 是否真的到账一律以服务端查单结果为准 —— 回调会延迟，客户端说了不算。

function requestWechatPayment(payment) {
  return new Promise((resolve, reject) => {
    if (!payment || !payment.package) {
      reject(new Error("支付参数缺失，请返回上一页重新下单"));
      return;
    }
    wx.requestPayment({
      timeStamp: String(payment.timeStamp || ""),
      nonceStr: String(payment.nonceStr || ""),
      package: String(payment.package || ""),
      signType: payment.signType || "RSA",
      paySign: String(payment.paySign || ""),
      success: () => resolve(true),
      fail: (error) => {
        const message = String((error && error.errMsg) || "");
        if (/cancel/i.test(message)) {
          const cancelled = new Error("已取消支付");
          cancelled.cancelled = true;
          reject(cancelled);
          return;
        }
        reject(new Error(message || "支付未完成"));
      }
    });
  });
}

// 统一处理"下单/充值接口回来了，接下来付不付、到没到账"。
// 返回 { paid, pending, cancelled, mode, wallet, order, message }，页面按它决定文案。
async function payAndConfirm(api, account, result) {
  // 没有 payment 字段 = 服务端已经直接入账（本机演示充值），无需微信支付。
  if (!result || !result.payment) {
    return { paid: true, pending: false, mode: "demo", wallet: (result && result.wallet) || null, order: null };
  }
  try {
    await requestWechatPayment(result.payment);
  } catch (error) {
    return {
      paid: false, pending: false, cancelled: Boolean(error.cancelled), mode: "wechat",
      message: error.message || "支付未完成"
    };
  }
  try {
    const confirmed = await api.confirmPayment(account, result.tradeNo);
    if (confirmed && confirmed.status === "paid") {
      return { paid: true, pending: false, mode: "wechat", wallet: confirmed.wallet || null, order: confirmed.order || null };
    }
    return {
      paid: false, pending: true, mode: "wechat",
      message: "微信已受理，支付结果确认中；稍后在余额或订单里刷新即可看到"
    };
  } catch (error) {
    return {
      paid: false, pending: true, mode: "wechat",
      message: error.message || "支付结果确认失败，稍后在余额或订单里刷新确认"
    };
  }
}

module.exports = { requestWechatPayment, payAndConfirm };
