import { HttpsProxyAgent } from 'https-proxy-agent';
import Telegraf, { Markup, Context } from 'telegraf';
import needle, { NeedleResponse } from 'needle';
import winston from 'winston';
import Aria2 from './Aria2';
import { TaskItem, Aria2EventTypes } from './typings';
import {
  byte2Readable, getFilename, progress, getGidFromAction, isDownloadable,
} from './utilities';

export default class Telegram {
  private bot: Telegraf<Context>;

  private aria2Server: Aria2;

  private logger: winston.Logger;

  private allowedUser: number[];

  private maxIndex: number;

  private agent: HttpsProxyAgent | undefined;

  constructor(options: {
    botKey: string;
    userId: number[];
    proxy: string | undefined;
    aria2Server: Aria2;
    maxIndex: number;
    logger: winston.Logger;
  }) {
    this.allowedUser = options.userId;
    this.aria2Server = options.aria2Server;
    this.maxIndex = options.maxIndex;
    this.logger = options.logger;

    if (options.proxy) {
      this.agent = new HttpsProxyAgent(options.proxy);
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

  private connect2Tg(tgSettings: {
    botKey: string;
  }): Telegraf<Context> {
    let additionalOptions = {};

    if (this.agent) {
      additionalOptions = {
        telegram: {
          // https://github.com/telegraf/telegraf/issues/955
          agent: this.agent,
        },
      };
    }

    return new Telegraf(tgSettings.botKey, additionalOptions);
  }

  private authentication(): void {
    this.bot.use((ctx, next) => {
      let incomingUserId;

      if (ctx.updateType === 'callback_query') {
        incomingUserId = ctx.update.callback_query?.from?.id;
      } else if (ctx.updateType === 'message') {
        incomingUserId = ctx.update.message?.from?.id;
      }

      if (incomingUserId && this.allowedUser.includes(incomingUserId) && next) {
        return next();
      }

      return ctx.reply('您没有权限使用此机器人哦 😢.');
    });
  }

  private replyOnAria2ServerEvent(event: Aria2EventTypes, message: string): void {
    this.aria2Server.on(event, (params) => {
      if (params.length && params[0].gid) {
        const { gid } = params[0];

        // Get task name by gid
        this.aria2Server.send('tellStatus', [gid], (task) => {
          const fileName = getFilename(task) || gid;
          const fullMessage = `[${fileName}] ${message}`;

          // Broadcast the message!
          this.allowedUser.forEach((userId) => this.bot.telegram.sendMessage(userId, fullMessage));
        });
      }
    });
  }

  private registerAria2ServerEvents(): void {
    // It happens when try to pause a pausing task.
    this.aria2Server.on('error', (error) => {
      // @ts-ignore This is a customized event, not easy to do it in the correct ts way.
      const message = `Error occured, code: ${error.code}, message: ${error.message}`;
      this.allowedUser.forEach((userId) => this.bot.telegram.sendMessage(userId, message));
    });

    this.replyOnAria2ServerEvent('downloadStart', '开始下载');
    this.replyOnAria2ServerEvent('downloadComplete', '下载完成');
    this.replyOnAria2ServerEvent('downloadPause', '暂停下载');
    // Try to download some non-existing URL to triger this error. e.g. https://1992342346.xyz/qwq122312
    this.replyOnAria2ServerEvent('downloadError',
      '下载错误, 请选择 ✅下载完成菜单查看详情',
    );
    this.replyOnAria2ServerEvent('downloadStop', '停止下载'); // Calling aria2.remove can triger this event.
  }

  private downloading(ctx: Context): void {
    this.aria2Server.send('tellActive', (data) => {
      if (Array.isArray(data)) {
        const parsed = data.map((item: TaskItem) => [
          `任务名称: ${getFilename(item)}`,
          `下载进度: ${progress(Number(item.totalLength), Number(item.completedLength))}`,
          `文件大小: ${byte2Readable(Number(item.totalLength))}`,
          `下载速度: ${byte2Readable(Number(item.downloadSpeed), '/s')}`,
        ].join('\n'));

        const message = parsed.join('\n\n') || '没有进行中的下载任务';

        ctx.reply(message);
      }
    });
  }

  private waiting(ctx: Context): void {
    this.aria2Server.send('tellWaiting', [-1, this.maxIndex], (data) => {
      if (Array.isArray(data)) {
        const parsed = data.map((item: TaskItem) => [
          `任务名称: ${getFilename(item)}`,
          `下载进度: ${progress(Number(item.totalLength), Number(item.completedLength))}`,
          `文件大小: ${byte2Readable(Number(item.totalLength))}`,
        ].join('\n'));

        const message = parsed.join('\n\n') || '没有等待中的下载任务';

        ctx.reply(message);
      }
    });
  }

  private stopped(ctx: Context): void {
    this.aria2Server.send('tellStopped', [-1, this.maxIndex], (data) => {
      if (Array.isArray(data)) {
        const parsed = data.map((item: TaskItem) => {
          const messageEntities = [
            `任务名称: ${getFilename(item)}`,
            `文件大小: ${byte2Readable(Number(item.totalLength))}`,
            `下载进度: ${progress(Number(item.totalLength), Number(item.completedLength))}`,
          ];

          if (item.errorMessage) {
            messageEntities.push(`Error: ${item.errorMessage}`);
          }

          return messageEntities.join('\n');
        });

        const message = parsed.join('\n\n') || '没有任何任务';

        ctx.reply(message);
      }
    });
  }

  private pause(ctx: Context): void {
    // List all active tasks
    this.aria2Server.send('tellActive', (data) => {
      if (!Array.isArray(data)) {
        return;
      }

      if (data.length === 0) {
        ctx.reply('没有进行中的任务');
      } else {
        // Build callback buttons.
        const buttons = data.map((item: TaskItem) => Markup.callbackButton(
          getFilename(item), `pause-task.${item.gid}`),
        );

        ctx.replyWithMarkdown(
          '要暂停哪一个?',
          Markup.inlineKeyboard(buttons, { columns: 1 }).extra(),
        );
      }
    });
  }

  private resume(ctx: Context): void {
    // List all waiting tasks
    this.aria2Server.send('tellWaiting', [-1, this.maxIndex], (data) => {
      if (!Array.isArray(data)) {
        return;
      }

      if (data.length === 0) {
        ctx.reply('没有等待的任务');
      } else {
        // Build callback buttons.
        const buttons = data.map((item: TaskItem) => Markup.callbackButton(
          getFilename(item), `resume-task.${item.gid}`),
        );

        ctx.replyWithMarkdown(
          '选择哪一个恢复?',
          Markup.inlineKeyboard(buttons, { columns: 1 }).extra(),
        );
      }
    });
  }

  private remove(ctx: Context): void {
    // List both waiting and active downloads
    const fullList: TaskItem[] = [];

    this.aria2Server.send('tellWaiting', [-1, this.maxIndex], (waitings) => {
      if (Array.isArray(waitings) && waitings.length) {
        fullList.push(...waitings);
      }

      this.aria2Server.send('tellActive', (actives) => {
        if (Array.isArray(actives) && actives.length) {
          fullList.push(...actives);
        }

        // Build callback buttons
        if (fullList.length === 0) {
          return ctx.reply('没有可删除的任);
        }

        // Build callback buttons.
        const buttons = fullList.map(
          (item: TaskItem) => Markup.callbackButton(getFilename(item), `remove-task.${item.gid}`),
        );

        return ctx.replyWithMarkdown(
          '选择哪一个删除?',
          Markup.inlineKeyboard(buttons, { columns: 1 }).extra(),
        );
      });
    });
  }

  private generalAction(method: string, ctx: Context): void {
    const data = ctx.update.callback_query?.data;
    let gid = '';

    if (data) {
      gid = getGidFromAction(data);

      if (gid) {
        if (method === 'pause') {
          ctx.reply('暂停任务可能需要一些时间，一旦完成会通知您.');
        }

        this.aria2Server.send(method, [gid]);
      } else {
        this.logger.warn('No gid presented');
      }
    }
  }

  private onMessage(): void {
    this.bot.on('message', (ctx) => {
      const inComingText = ctx.update.message?.text;

      if (inComingText) {
        this.logger.info(`Received message from Telegram: ${inComingText}`);

        switch (inComingText) {
          case '⬇️ 正在下载':
            this.downloading(ctx);
            break;
          case '⌛️ 等待下载':
            this.waiting(ctx);
            break;
          case '✅ 下载完成':
            this.stopped(ctx);
            break;
          case '⏸️ 暂停任务':
            this.pause(ctx);
            break;
          case '▶️ 恢复任务':
            this.resume(ctx);
            break;
          case '❌ 删除任务':
            this.remove(ctx);
            break;
          default:
            if (isDownloadable(inComingText)) {
              this.aria2Server.send('addUri', [[inComingText]]);
            } else {
              this.logger.warn(`Unable to a parse the request: ${inComingText}`);
            }
        }
      }

      const document = ctx.update.message?.document;

      // Receive BT file
      if (document && document.file_name && isDownloadable(document.file_name)) {
        this.logger.info(`Received BT file from Telegram: ${document.file_name}`);

        ctx.telegram.getFileLink(document.file_id)
          .then((url) => {
            // Download file
            // @ts-ignore - TODO: https://github.com/TooTallNate/node-socks-proxy-agent/issues/52
            needle.get(url, { agent: this.agent }, (error: Error, response: NeedleResponse) => {
              if (!error && response.statusCode === 200) {
                const base64EncodedTorrent = response.body.toString('base64');
                this.aria2Server.send('addTorrent', [base64EncodedTorrent]);
              }
            });
          });
      }
    });
  }

  private onAction(): void {
    // Match all actions
    this.bot.action(/.*/, (ctx) => {
      const data = ctx.update.callback_query?.data;

      if (!data) {
        return;
      }

      const actionName = data.split('.')[0];

      switch (actionName) {
        case 'pause-task':
          this.generalAction('pause', ctx);
          break;
        case 'resume-task':
          this.generalAction('unpause', ctx);
          break;
        case 'remove-task':
          this.generalAction('forceRemove', ctx);
          break;
        default:
          this.logger.warn(`No matched action for ${actionName}`);
      }
    });
  }

  private onStart(): void {
    this.bot.start((ctx) => {
      // Welcome message
      ctx.replyWithMarkdown(
        '亲爱的，你回来啦😘',
        Markup.inlineKeyboard([
          Markup.urlButton('️🔷 GitHub', 'https://github.com/li-peifeng/tele-aria2'),
          Markup.urlButton('🔶 我的主页 ', 'https://peifeng.li'),
        ], { columns: 2 }).extra(),
      );

      // Keyboard
      ctx.replyWithMarkdown(
        '请选择一个选项开始吧',
        Markup.keyboard([
          '⬇️ 正在下载', '⌛️ 等待下载', 
          '✅ 下载完成', '⏸️ 暂停任务', 
          '▶️ 恢复任务', '❌ 删除任务',
        ], { columns: 2 }).extra(),
      );
    });
  }

  launch(): void {
    this.bot.launch();
  }
}
