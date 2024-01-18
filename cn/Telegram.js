"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
var https_proxy_agent_1 = require("https-proxy-agent");
var telegraf_1 = __importStar(require("telegraf"));
var needle_1 = __importDefault(require("needle"));
var utilities_1 = require("./utilities");
var Telegram = /** @class */ (function () {
    function Telegram(options) {
        this.allowedUser = options.userId;
        this.aria2Server = options.aria2Server;
        this.maxIndex = options.maxIndex;
        this.logger = options.logger;
        if (options.proxy) {
            this.agent = new https_proxy_agent_1.HttpsProxyAgent(options.proxy);
        }
        this.bot = this.connect2Tg({
            botKey: options.botKey,
        });
        this.registerAria2ServerEvents();
        this.authentication();
        this.onStart();
        this.onMessage();
        this.onAction();
    }
    Telegram.prototype.connect2Tg = function (tgSettings) {
        var additionalOptions = {};
        if (this.agent) {
            additionalOptions = {
                telegram: {
                    // https://github.com/telegraf/telegraf/issues/955
                    agent: this.agent,
                },
            };
        }
        return new telegraf_1.default(tgSettings.botKey, additionalOptions);
    };
    Telegram.prototype.authentication = function () {
        var _this = this;
        this.bot.use(function (ctx, next) {
            var _a, _b, _c, _d;
            var incomingUserId;
            if (ctx.updateType === 'callback_query') {
                incomingUserId = (_b = (_a = ctx.update.callback_query) === null || _a === void 0 ? void 0 : _a.from) === null || _b === void 0 ? void 0 : _b.id;
            }
            else if (ctx.updateType === 'message') {
                incomingUserId = (_d = (_c = ctx.update.message) === null || _c === void 0 ? void 0 : _c.from) === null || _d === void 0 ? void 0 : _d.id;
            }
            if (incomingUserId && _this.allowedUser.includes(incomingUserId) && next) {
                return next();
            }
            return ctx.reply('您没有权限使用此机器人哦 😢.');
        });
    };
    Telegram.prototype.replyOnAria2ServerEvent = function (event, message) {
        var _this = this;
        this.aria2Server.on(event, function (params) {
            if (params.length && params[0].gid) {
                var gid_1 = params[0].gid;
                // Get task name by gid
                _this.aria2Server.send('tellStatus', [gid_1], function (task) {
                    var fileName = utilities_1.getFilename(task) || gid_1;
                    var fullMessage = "[" + fileName + "] " + message;
                    // Broadcast the message!
                    _this.allowedUser.forEach(function (userId) { return _this.bot.telegram.sendMessage(userId, fullMessage); });
                });
            }
        });
    };
    Telegram.prototype.registerAria2ServerEvents = function () {
        var _this = this;
        // It happens when try to pause a pausing task.
        this.aria2Server.on('error', function (error) {
            // @ts-ignore This is a customized event, not easy to do it in the correct ts way.
            var message = "Error occured, code: " + error.code + ", message: " + error.message;
            _this.allowedUser.forEach(function (userId) { return _this.bot.telegram.sendMessage(userId, message); });
        });
        this.replyOnAria2ServerEvent('downloadStart', '开始下载');
        this.replyOnAria2ServerEvent('downloadComplete', '下载完成');
        this.replyOnAria2ServerEvent('downloadPause', '暂停下载');
        // Try to download some non-existing URL to triger this error. e.g. https://1992342346.xyz/qwq122312
        this.replyOnAria2ServerEvent('downloadError', '下载错误, 请选择 ✅下载完成菜单查看详情');
        this.replyOnAria2ServerEvent('downloadStop', '停止下载'); // Calling aria2.remove can triger this event.
    };
    Telegram.prototype.downloading = function (ctx) {
        this.aria2Server.send('tellActive', function (data) {
            if (Array.isArray(data)) {
                var parsed = data.map(function (item) { return [
                    "\u4EFB\u52A1\u540D\u79F0: " + utilities_1.getFilename(item),
                    "\u4E0B\u8F7D\u8FDB\u5EA6: " + utilities_1.progress(Number(item.totalLength), Number(item.completedLength)),
                    "\u6587\u4EF6\u5927\u5C0F: " + utilities_1.byte2Readable(Number(item.totalLength)),
                    "\u4E0B\u8F7D\u901F\u5EA6: " + utilities_1.byte2Readable(Number(item.downloadSpeed), '/s'),
                ].join('\n'); });
                var message = parsed.join('\n\n') || '没有进行中的下载任务';
                ctx.reply(message);
            }
        });
    };
    Telegram.prototype.waiting = function (ctx) {
        this.aria2Server.send('tellWaiting', [-1, this.maxIndex], function (data) {
            if (Array.isArray(data)) {
                var parsed = data.map(function (item) { return [
                    "\u4EFB\u52A1\u540D\u79F0: " + utilities_1.getFilename(item),
                    "\u4E0B\u8F7D\u8FDB\u5EA6: " + utilities_1.progress(Number(item.totalLength), Number(item.completedLength)),
                    "\u6587\u4EF6\u5927\u5C0F: " + utilities_1.byte2Readable(Number(item.totalLength)),
                ].join('\n'); });
                var message = parsed.join('\n\n') || '没有等待中的下载任务';
                ctx.reply(message);
            }
        });
    };
    Telegram.prototype.stopped = function (ctx) {
        this.aria2Server.send('tellStopped', [-1, this.maxIndex], function (data) {
            if (Array.isArray(data)) {
                var parsed = data.map(function (item) {
                    var messageEntities = [
                        "\u4EFB\u52A1\u540D\u79F0: " + utilities_1.getFilename(item),
                        "\u6587\u4EF6\u5927\u5C0F: " + utilities_1.byte2Readable(Number(item.totalLength)),
                        "\u4E0B\u8F7D\u8FDB\u5EA6: " + utilities_1.progress(Number(item.totalLength), Number(item.completedLength)),
                    ];
                    if (item.errorMessage) {
                        messageEntities.push("Error: " + item.errorMessage);
                    }
                    return messageEntities.join('\n');
                });
                var message = parsed.join('\n\n') || '没有任何任务';
                ctx.reply(message);
            }
        });
    };
    Telegram.prototype.pause = function (ctx) {
        // List all active tasks
        this.aria2Server.send('tellActive', function (data) {
            if (!Array.isArray(data)) {
                return;
            }
            if (data.length === 0) {
                ctx.reply('没有进行中的任务');
            }
            else {
                // Build callback buttons.
                var buttons = data.map(function (item) { return telegraf_1.Markup.callbackButton(utilities_1.getFilename(item), "pause-task." + item.gid); });
                ctx.replyWithMarkdown('要暂停哪一个?', telegraf_1.Markup.inlineKeyboard(buttons, { columns: 1 }).extra());
            }
        });
    };
    Telegram.prototype.resume = function (ctx) {
        // List all waiting tasks
        this.aria2Server.send('tellWaiting', [-1, this.maxIndex], function (data) {
            if (!Array.isArray(data)) {
                return;
            }
            if (data.length === 0) {
                ctx.reply('没有等待的任务');
            }
            else {
                // Build callback buttons.
                var buttons = data.map(function (item) { return telegraf_1.Markup.callbackButton(utilities_1.getFilename(item), "resume-task." + item.gid); });
                ctx.replyWithMarkdown('选择哪一个恢复?', telegraf_1.Markup.inlineKeyboard(buttons, { columns: 1 }).extra());
            }
        });
    };
    Telegram.prototype.remove = function (ctx) {
        var _this = this;
        // List both waiting and active downloads
        var fullList = [];
        this.aria2Server.send('tellWaiting', [-1, this.maxIndex], function (waitings) {
            if (Array.isArray(waitings) && waitings.length) {
                fullList.push.apply(fullList, waitings);
            }
            _this.aria2Server.send('tellActive', function (actives) {
                if (Array.isArray(actives) && actives.length) {
                    fullList.push.apply(fullList, actives);
                }
                // Build callback buttons
                if (fullList.length === 0) {
                    return ctx.reply('没有可删除的任务');
                }
                // Build callback buttons.
                var buttons = fullList.map(function (item) { return telegraf_1.Markup.callbackButton(utilities_1.getFilename(item), "remove-task." + item.gid); });
                return ctx.replyWithMarkdown('选择哪一个删除?', telegraf_1.Markup.inlineKeyboard(buttons, { columns: 1 }).extra());
            });
        });
    };
    Telegram.prototype.generalAction = function (method, ctx) {
        var _a;
        var data = (_a = ctx.update.callback_query) === null || _a === void 0 ? void 0 : _a.data;
        var gid = '';
        if (data) {
            gid = utilities_1.getGidFromAction(data);
            if (gid) {
                if (method === 'pause') {
                    ctx.reply('暂停任务可能需要一些时间，一旦完成会通知您.');
                }
                this.aria2Server.send(method, [gid]);
            }
            else {
                this.logger.warn('No gid presented');
            }
        }
    };
    Telegram.prototype.onMessage = function () {
        var _this = this;
        this.bot.on('message', function (ctx) {
            var _a, _b;
            var inComingText = (_a = ctx.update.message) === null || _a === void 0 ? void 0 : _a.text;
            if (inComingText) {
                _this.logger.info("Received message from Telegram: " + inComingText);
                switch (inComingText) {
                    case '⬇️ 正在下载':
                        _this.downloading(ctx);
                        break;
                    case '⌛️ 等待下载':
                        _this.waiting(ctx);
                        break;
                    case '✅ 下载完成':
                        _this.stopped(ctx);
                        break;
                    case '⏸️ 暂停任务':
                        _this.pause(ctx);
                        break;
                    case '▶️ 恢复任务':
                        _this.resume(ctx);
                        break;
                    case '❌ 删除任务':
                        _this.remove(ctx);
                        break;
                    default:
                        if (utilities_1.isDownloadable(inComingText)) {
                            _this.aria2Server.send('addUri', [[inComingText]]);
                        }
                        else {
                            _this.logger.warn("Unable to a parse the request: " + inComingText);
                        }
                }
            }
            var document = (_b = ctx.update.message) === null || _b === void 0 ? void 0 : _b.document;
            // Receive BT file
            if (document && document.file_name && utilities_1.isDownloadable(document.file_name)) {
                _this.logger.info("Received BT file from Telegram: " + document.file_name);
                ctx.telegram.getFileLink(document.file_id)
                    .then(function (url) {
                    // Download file
                    // @ts-ignore - TODO: https://github.com/TooTallNate/node-socks-proxy-agent/issues/52
                    needle_1.default.get(url, { agent: _this.agent }, function (error, response) {
                        if (!error && response.statusCode === 200) {
                            var base64EncodedTorrent = response.body.toString('base64');
                            _this.aria2Server.send('addTorrent', [base64EncodedTorrent]);
                        }
                    });
                });
            }
        });
    };
    Telegram.prototype.onAction = function () {
        var _this = this;
        // Match all actions
        this.bot.action(/.*/, function (ctx) {
            var _a;
            var data = (_a = ctx.update.callback_query) === null || _a === void 0 ? void 0 : _a.data;
            if (!data) {
                return;
            }
            var actionName = data.split('.')[0];
            switch (actionName) {
                case 'pause-task':
                    _this.generalAction('pause', ctx);
                    break;
                case 'resume-task':
                    _this.generalAction('unpause', ctx);
                    break;
                case 'remove-task':
                    _this.generalAction('forceRemove', ctx);
                    break;
                default:
                    _this.logger.warn("No matched action for " + actionName);
            }
        });
    };
    Telegram.prototype.onStart = function () {
        this.bot.start(function (ctx) {
            // Welcome message
            ctx.replyWithMarkdown('亲爱的，你回来啦😘', telegraf_1.Markup.inlineKeyboard([
                telegraf_1.Markup.urlButton('️🔷 联系', 'https://t.me/leolitaly'),
                telegraf_1.Markup.urlButton('🔶 主页 ', 'https://peifeng.li'),
            ], { columns: 2 }).extra());
            // Keyboard
            ctx.replyWithMarkdown('请选择一个选项开始吧', telegraf_1.Markup.keyboard([
                '⬇️ 正在下载', '⌛️ 等待下载',
                '✅ 下载完成', '⏸️ 暂停任务',
                '▶️ 恢复任务', '❌ 删除任务',
            ], { columns: 2 }).extra());
        });
    };
    Telegram.prototype.launch = function () {
        this.bot.launch();
    };
    return Telegram;
}());
exports.default = Telegram;
//# sourceMappingURL=Telegram.js.map
