const nodemailer = require("nodemailer");

const MAIL_HOST = "sandbox.smtp.mailtrap.io";
const MAIL_PORT = 2525;
const MAIL_USER = process.env.MAILTRAP_USER || "eac541160f7ce6";
const MAIL_PASS = process.env.MAILTRAP_PASS || "7df088a34c939e";
const MAIL_FROM = process.env.MAIL_FROM || "no-reply@nnptud.local";

const transporter = nodemailer.createTransport({
    host: MAIL_HOST,
    port: MAIL_PORT,
    secure: false,
    auth: {
        user: MAIL_USER,
        pass: MAIL_PASS,
    },
});

module.exports = {
    sendMail: async function (to, url) {
        const info = await transporter.sendMail({
            from: MAIL_FROM,
            to: to,
            subject: "Reset Password email",
            text: "click vao duong dan de reset password: " + url,
            html: "click vao <a href=\"" + url + "\">day</a> de reset password",
        });
        return info;
    },
    sendPasswordMail: async function (to, username, password) {
        const info = await transporter.sendMail({
            from: MAIL_FROM,
            to: to,
            subject: "Thong tin tai khoan",
            text: "username: " + username + "\npassword: " + password,
            html: "<p>Tai khoan cua ban da duoc tao.</p>"
                + "<p>username: <b>" + username + "</b></p>"
                + "<p>password: <b>" + password + "</b></p>"
        });
        return info;
    }
}
