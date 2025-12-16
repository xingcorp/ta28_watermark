import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import * as dotenv from "dotenv";
dotenv.config();

(async () => {
  const stringSession = new StringSession(""); // Tạo session mới
  const client = new TelegramClient(
    stringSession,
    Number(process.env.APP_API_ID),
    String(process.env.APP_API_HASH),
    { connectionRetries: 5 }
  );

  await client.connect();
  await client.start({
    phoneNumber: async () => await input("Nhập số điện thoại: "),
    password: async () => await input("Nhập 2FA password (nếu có): "),
    phoneCode: async () => await input("Nhập code được gửi đến điện thoại: "),
    onError: (err) => console.log(err),
  });

  console.log("Bạn đã đăng nhập thành công!");
  console.log("Session string:", client.session.save());
  await client.sendMessage("me", { message: "Test message" });
})();

function input(message) {
  return new Promise((resolve, reject) => {
    process.stdout.write(message);
    process.stdin.once("data", (data) => {
      resolve(data.toString().trim());
    });
  });
}
