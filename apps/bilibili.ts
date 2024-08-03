import JSON from 'json5';
import lodash from 'lodash';
import { Bot, Plugin, Redis } from 'yunzai';
import { BiliQuery } from '../models/bilibili/bilibili.query';
import { BiliTask } from '../models/bilibili/bilibili.task';
import Config from '../utils/config';
import { _paths } from '../utils/paths';
import { BiliGetWebData } from '../models/bilibili/bilibili.get.web.data';
import {
  applyLoginQRCode,
  checkBiliLogin,
  exitBiliLogin,
  getNewTempCk,
  pollLoginQRCode,
  postGateway,
  readSavedCookieItems,
  readSyncCookie,
  saveLocalBiliCk,
  saveLoginCookie,
  readTempCk
} from '../models/bilibili/bilibili.models.ts';

declare const logger: any;

export default class YukiBili extends Plugin {
  constructor() {
    super();
    this.rule = [
      {
        reg: "^(#|\/)(yuki|优纪)?执行(b站|B站|bili|bilibili|哔哩|哔哩哔哩)任务$",
        fnc: this.newPushTask.name,
        permission: "master",
      },
      {
        reg: "^(#|\/)(yuki|优纪)?(订阅|添加|add|ADD)(b站|B站|bili|bilibili|哔哩|哔哩哔哩)推送\s*(视频\s*|图文\s*|文章\s*|转发\s*|直播\s*)*.*$",
        fnc: this.addDynamicSub.name,
      },
      {
        reg: "^(#|\/)(yuki|优纪)?(取消|删除|del|DEL)(b站|B站|bili|bilibili|哔哩|哔哩哔哩)推送\s*(视频\s*|图文\s*|文章\s*|转发\s*|直播\s*)*.*$",
        fnc: this.delDynamicSub.name,
      },
      {
        reg: "^(#|\/)(yuki|优纪)?(扫码|添加|ADD|add)(b站|B站|bili|bilibili|哔哩|哔哩哔哩)登录$",
        fnc: this.scanBiliLogin.name,
      },
      {
        reg: "^(#|\/)(yuki|优纪)?(取消|删除|del|DEL)(b站|B站|bili|bilibili|哔哩|哔哩哔哩)登录$",
        fnc: this.delBiliLogin.name,
      },
      {
        reg: "^(#|\/)(yuki|优纪)?我的(b站|B站|bili|bilibili|哔哩|哔哩哔哩)登录$",
        fnc: this.myBiliLoginInfo.name,
      },
      {
        reg: "^(#|\/)(yuki|优纪)?(绑定|添加|ADD|add)(b站|B站|bili|bilibili|哔哩|哔哩哔哩)本地(ck|CK|cookie|COOKIE)(:|：)?.*$",
        fnc: this.addLocalBiliCookie.name,
      },
      {
        reg: "^(#|\/)(yuki|优纪)?(取消|删除|del|DEL)(b站|B站|bili|bilibili|哔哩|哔哩哔哩)本地(ck|CK|cookie|COOKIE)$",
        fnc: this.delLocalBiliCookie.name,
      },
      {
        reg: "^(#|\/)(yuki|优纪)?我的(b站|B站|bili|bilibili|哔哩|哔哩哔哩)(ck|CK|cookie|COOKIE)$",
        fnc: this.myUsingBiliCookie.name,
      },
      {
        reg: "^(#|\/)(yuki|优纪)?刷新(b站|B站|bili|bilibili|哔哩|哔哩哔哩)临时(ck|CK|cookie|COOKIE)$",
        fnc: this.reflashTempCk.name,
      },
      {
        reg: "^(#|\/)(yuki|优纪)?(b站|B站|bili|bilibili|哔哩|哔哩哔哩)全部(推送|动态|订阅)列表$",
        fnc: this.allSubDynamicPushList.name,
      },
      {
        reg: "^(#|\/)(yuki|优纪)?(b站|B站|bili|bilibili|哔哩|哔哩哔哩)(推送|动态|订阅)列表$",
        fnc: this.singelSubDynamicPushList.name,
      },
      {
        reg: "^(#|\/)(yuki|优纪)?(b站|B站|bili|bilibili|哔哩|哔哩哔哩)(up|UP)主.*$",
        fnc: this.getBilibiUserInfoByUid.name,
      },
      {
        reg: "^(#|\/)(yuki|优纪)?搜索(b站|B站|bili|bilibili|哔哩|哔哩哔哩)(up|UP)主.*$",
        fnc: this.searchBiliUserInfoByKeyword.name,
      },
    ]
    this.biliConfigData = Config.getConfigData("config", "bilibili", "config");
    this.biliPushData = Config.getConfigData("config", "bilibili", "push");

    /** 定时任务 */
    this.task = {
      cron: !!this.biliConfigData.pushStatus ? this.biliConfigData.pushTime : "",
      name: "yuki插件---B站动态推送定时任务",
      fnc: () => this.newPushTask(),
      log: !!this.biliConfigData.pushTaskLog,
    };
  }
  biliConfigData: any;
  biliPushData: any;

  /** B站动态推送定时任务 */
  async newPushTask() {
    await new BiliTask(this.e).runTask();
  }

  /** 添加B站动态订阅 */
  async addDynamicSub() {
    if (!this.e.isMaster) {
      this.e.reply("未取得bot主人身份，无权限添加B站动态订阅");
    } else {
      // 从消息中提取UID
      const uid = this.e.msg.replace(/^(#|\/)(yuki|优纪)?(订阅|添加|add|ADD)(b站|B站|bili|bilibili|哔哩|哔哩哔哩)推送\s*(视频\s*|图文\s*|文章\s*|转发\s*|直播\s*)*/g, "").trim();
      if (!uid) {
        this.e.reply(`请在指令末尾指定订阅的B站up主的UID！`);
        return true;
      }

      // 获取或初始化推送数据
      let subData = this.biliPushData || { group: {}, private: {} };

      // 根据聊天类型初始化数据
      let chatType = this.e.isGroup ? "group" : "private";
      let chatId = this.e.isGroup ? this.e.group_id : this.e.user_id;

      // 初始化群组或私聊数据
      if (!subData[chatType][chatId]) {
        subData[chatType][chatId] = [];
      }

      // 检查该 uid 是否已存在
      const upData = subData[chatType][chatId].find((item) => item.uid === uid);

      if (upData) {
        // 更新推送类型
        upData.type = BiliQuery.typeHandle(upData, this.e.msg, "add");
        this.biliPushData = subData;
        await Config.saveConfig("config", "bilibili", "push", subData);
        this.e.reply(`修改b站推送动态类型成功~\n${upData.name}：${uid}`);
        return;
      }

      // 获取 Bilibili 动态信息
      const res = await new BiliGetWebData(this.e).getBiliDynamicListDataByUid(uid);

      if (res.statusText !== "OK") {
        this.e.reply("出了点网络问题，等会再试试吧~");
        return false;
      }

      const resData = res.data || {};

      if (resData.code !== 0) {
        this.e.reply(`订阅校验失败~\nup主uid：${uid} 可能是无效的，或遭遇了风控，请稍后再试~`);
        logger.mark(`yuki-plugin addDynamicSub Failed：${JSON.stringify(resData)}`);
        return true;
      }

      const { items } = resData.data || {};

      let name = items.length > 0 ? (items[0].modules.module_author?.name || uid) : uid;

      // 添加新的推送数据
      subData[chatType][chatId].push({
        bot_id: this.e.self_id, // 使用 bot_id， 对应 e_self_id
        uid,
        name: name,
        type: BiliQuery.typeHandle({ uid, name }, this.e.msg, "add"),
      });

      this.biliPushData = subData;
      Config.saveConfig("config", "bilibili", "push", subData);
      this.e.reply(`添加b站推送成功~\n${name}：${uid}`);
    }
  }


  /** 删除B站动态订阅 */
  async delDynamicSub() {
    if (!this.e.isMaster) {
      this.e.reply("未取得bot主人身份，无权限删除B站动态订阅");
    } else {
      // 提取用户输入的UID
      const uid = this.e.msg.replace(/^(#|\/)(yuki|优纪)?(取消|删除|del|DEL)(b站|B站|bili|bilibili|哔哩|哔哩哔哩)推送\s*(视频\s*|图文\s*|文章\s*|转发\s*|直播\s*)*/g, "").trim();
      if (!uid) {
        this.e.reply(`请在指令末尾指定订阅的B站up主的UID！`);
        return;
      }

      // 获取或初始化B站推送数据
      let subData = this.biliPushData || { group: {}, private: {} };

      // 根据聊天类型初始化数据
      let chatType = this.e.isGroup ? "group" : "private";
      let chatId = this.e.isGroup ? this.e.group_id : this.e.user_id;

      // 初始化群组或私聊数据
      if (!subData[chatType][chatId]) {
        subData[chatType][chatId] = [];
      }

      // 查找指定UID的订阅数据
      const upData = subData[chatType][chatId].find((item: { uid: string; }) => item.uid == uid);
      if (!upData) {
        this.e.reply(`订阅列表中没有找到该UID~\n${uid}可能是无效的`);
        return;
      }

      // 处理订阅类型
      const newType = BiliQuery.typeHandle(upData, this.e.msg, "del");
      let isDel = false;

      if (newType.length) {
        // 更新订阅类型
        subData[chatType][chatId] = subData[chatType][chatId].map((item) => {
          if (item.uid == uid) {
            item.type = newType;
          }
          return item;
        });
      } else {
        // 删除订阅
        isDel = true;
        subData[chatType][chatId] = subData[chatType][chatId].filter((item) => item.uid !== uid);
      }

      // 保存更新后的数据
      this.biliPushData = subData;
      Config.saveConfig("config", "bilibili", "push", subData);

      // 回复用户操作结果
      this.e.reply(`${isDel ? "删除" : "修改"}b站推送成功~\n${uid}`);
    }
  }

  /** 扫码登录B站 */
  async scanBiliLogin() {
    if (this.e.isMaster) {
      try {
        const token = await applyLoginQRCode(this.e);

        let biliLoginCk = await pollLoginQRCode(this.e, token);

        //let _uuid = readSavedCookieItems(biliLoginCk, ['_uuid'])

        //const buvid_fp = await get_buvid_fp(_uuid);

        //biliLoginCk = buvid_fp + biliLoginCk;

        if (lodash.trim(biliLoginCk).length != 0) {
          await saveLoginCookie(this.e, biliLoginCk);
          this.e.reply(`get bilibili LoginCk：成功！`)
          const result = await postGateway(biliLoginCk); //激活ck

          const { code, data } = await result.data; // 解析校验结果

          switch (code) {
            case 0:
              (logger ?? Bot.logger)?.mark(`优纪插件：获取biliLoginCK，Gateway校验成功：${JSON.stringify(data)}`);
              break;
            default:
              (logger ?? Bot.logger)?.mark(`优纪插件：获取biliLoginCK，Gateway校验失败：${JSON.stringify(data)}`);
              break;
          }
        } else {
          this.e.reply(`get bilibili LoginCk：失败X﹏X`)
        }
      } catch (Error) {
        (logger ?? Bot.logger)?.info(`yuki-plugin Login bilibili Failed：${Error}`);
      }
    } else {
      this.e.reply("未取得bot主人身份，无权限配置B站登录ck");
    }
  }

  /** 删除登陆的B站ck */
  async delBiliLogin() {
    if (this.e.isMaster) {
      await exitBiliLogin(this.e);
      await Redis.set("Yz:yuki:bili:loginCookie", "", { EX: 3600 * 24 * 180 });
      this.e.reply(`登陆的B站ck并已删除~`);
    } else {
      this.e.reply("未取得bot主人身份，无权限删除B站登录ck");
    }
  }

  /**验证B站登录 */
  async myBiliLoginInfo() {
    if (this.e.isMaster) {
      await checkBiliLogin(this.e);
    } else {
      this.e.reply("未取得bot主人身份，无权限查看B站登录状态");
    }
  }

  /** 手动绑定本地获取的B站cookie */
  async addLocalBiliCookie() {
    if (this.e.isMaster) {
      if (this.e.isPrivate) {
        await this.reply('请注意账号安全，请手动撤回发送的cookie，并私聊进行添加绑定！')
      } else {
        let localBiliCookie = this.e.msg.replace(/^(#|\/)(yuki|优纪)?(绑定|添加|ADD|add)(b站|B站|bili|bilibili|哔哩|哔哩哔哩)(ck|CK|cookie|COOKIE)(:|：)?/g, "").trim();

        let param: any = {}
        localBiliCookie.split(';').forEach((v) => {
          // 处理分割特殊cookie_token
          let tmp = lodash.trim(v).replace('=', '$').split('$')
          param[tmp[0]] = tmp[1]
        })

        if (!param.buvid3 || !param._uuid || !param.buvid4 || !param.DedeUserID) {
          await this.e.reply('发送的cookie字段缺失\n请添加完整cookie\n获取方法查看仓库主页。');

          const missingCookies = [];
          if (!param.buvid3 || param.buvid3.length === 0) {
            missingCookies.push('buvid3');
          }
          if (!param.buvid4 || param.buvid4.length === 0) {
            missingCookies.push('buvid4');
          }
          if (!param._uuid || param._uuid.length === 0) {
            missingCookies.push('_uuid');
          }
          if (!param.DedeUserID || param.DedeUserID.length === 0) {
            missingCookies.push('DedeUserID');
          }

          if (missingCookies.length > 0) {
            await this.e.reply(`当前缺失字段：\n${missingCookies.join('\n')}`);
          }
          return;
        }

        //筛选ck
        localBiliCookie = await readSavedCookieItems(localBiliCookie, ['buvid3', 'buvid4', '_uuid', 'SESSDATA', 'DedeUserID', 'DedeUserID__ckMd5', 'bili_jct', 'b_nut', 'b_lsid'], false)

        //const buvid_fp = await get_buvid_fp(param._uuid)

        //localBiliCookie = buvid_fp + localBiliCookie; //添加buvid_fp值

        await saveLocalBiliCk(localBiliCookie);

        logger.mark(`${this.e.logFnc} 保存B站cookie成功 [UID:${param.DedeUserID}]`)

        let uidMsg = [`好耶~绑定B站cookie成功：\n${param.DedeUserID}`]

        await this.e.reply(uidMsg);

        const result = await postGateway(localBiliCookie); //激活ck

        const { code, data } = await result.data; // 解析校验结果

        switch (code) {
          case 0:
            (logger ?? Bot.logger)?.mark(`优纪插件：绑定localCK，Gateway校验成功：${JSON.stringify(data)}`);
            break;
          default:
            (logger ?? Bot.logger)?.mark(`优纪插件：绑定localCK，Gateway校验失败：${JSON.stringify(data)}`);
            break;
        }
      }
    } else {
      this.e.reply("未取得bot主人身份，无权限配置B站登录ck");
    }
  }

  /** 删除绑定的本地B站ck */
  async delLocalBiliCookie() {
    if (this.e.isMaster) {
      await saveLocalBiliCk("")
      await this.e.reply(`手动绑定的B站ck已删除~`)
    } else {
      this.e.reply("未取得bot主人身份，无权限删除B站登录ck");
    }
  }

  /** 当前正在使用的B站ck */
  async myUsingBiliCookie() {
    if (this.e.isGroup) {
      await this.reply('注意账号安全，请私聊查看叭')
    } else {
      if (this.e.isMaster) {
        let { cookie, mark } = await readSyncCookie();
        if (mark === "localCk") {
          this.e.reply(`当前使用本地获取的B站cookie：`);
          this.e.reply(`${cookie}`);
        } else if (mark === "loginCk") {
          this.e.reply(`当前使用扫码登录的B站cookie：`);
          this.e.reply(`${cookie}`);
        } else if (mark === "tempCk") {
          this.e.reply(`当前使用自动获取的临时B站cookie：`);
          this.e.reply(`${cookie}`);
        } else if (mark == 'ckIsEmpty') {
          this.e.reply(`当前无可使用的B站cookie。`)
        }
      } else {
        this.e.reply("未取得bot主人身份，无权限查看当前使用的B站cookie");
      }
    }
  }

  /** 删除并刷新redis缓存的临时B站ck */
  async reflashTempCk() {
    try {
      await getNewTempCk();
      let newTempCk = await readTempCk();
      if ((newTempCk !== null) && (newTempCk !== undefined) && (newTempCk.length !== 0) && (newTempCk !== '')) {
        this.e.reply(`~yuki-plugin:\n临时b站ck刷新成功~❤~\n接下来如果获取动态失败，请重启bot(手动或发送指令 #重启)刷新状态~\n如果重启续仍不可用，请考虑 #优纪添加b站登录 吧~`);
      } else {
        this.e.reply(`~yuki-plugin:\n临时b站ck刷新失败X﹏X\n请重启bot(手动或发送指令 #重启)后重试`);
      }
    } catch (error) {
      this.e.reply(`~yuki-plugin:\n临时b站ck刷新失败X﹏X\n请重启bot(手动或发送指令 #重启)后重试`);
      (logger ?? Bot.logger)?.mark(`优纪插件：B站临时ck刷新error：${error}`);
    }
  }

  /** 订阅的全部b站推送列表 */
  async allSubDynamicPushList() {
    if (!this.e.isMaster) {
      this.e.reply("未取得bot主人身份，无权限查看Bot的全部B站订阅列表");
    } else {
      let subData = this.biliPushData || { group: {}, private: {} };

      const messages = [];

      const typeMap = {
        DYNAMIC_TYPE_AV: "视频",
        DYNAMIC_TYPE_WORD: "图文",
        DYNAMIC_TYPE_DRAW: "图文",
        DYNAMIC_TYPE_ARTICLE: "文章",
        DYNAMIC_TYPE_FORWARD: "转发",
        DYNAMIC_TYPE_LIVE_RCMD: "直播",
      };

      // 处理群组订阅
      if (subData.group && Object.keys(subData.group).length > 0) {
        messages.push("------群组B站订阅------");
        Object.keys(subData.group).forEach((groupId) => {
          messages.push(`群组ID：${groupId}：`);
          subData.group[groupId].forEach((item: { type: any[]; uid: any; name: any; }) => {
            const types = new Set();

            if (item.type && item.type.length) {
              item.type.forEach((typeItem: string | number) => {
                if (typeMap[typeItem]) {
                  types.add(typeMap[typeItem]);
                }
              });
            }

            messages.push(
              `${item.name}：${item.uid}  ${types.size ? `[${Array.from(types).join("、")}]` : " [全部动态]"}`
            );
          });
        });
      }

      // 处理私聊订阅
      if (subData.private && Object.keys(subData.private).length > 0) {
        messages.push("------私聊B站订阅------");
        Object.keys(subData.private).forEach((userId) => {
          messages.push(`用户ID：${userId}：`);
          subData.private[userId].forEach((item: { type: any[]; uid: any; name: any; }) => {
            const types = new Set();

            if (item.type && item.type.length) {
              item.type.forEach((typeItem: string | number) => {
                if (typeMap[typeItem]) {
                  types.add(typeMap[typeItem]);
                }
              });
            }

            messages.push(
              `${item.name}：${item.uid}  ${types.size ? `[${Array.from(types).join("、")}]` : " [全部动态]"}`
            );
          });
        });
      }

      this.e.reply(`推送列表如下：\n${messages.join("\n")}`);
    }
  }

  /** 单独群聊或私聊的订阅的b站推送列表 */
  async singelSubDynamicPushList() {
    let subData = this.biliPushData || { group: {}, private: {} };

    const messages = [];

    const typeMap = {
      DYNAMIC_TYPE_AV: "视频",
      DYNAMIC_TYPE_WORD: "图文",
      DYNAMIC_TYPE_DRAW: "图文",
      DYNAMIC_TYPE_ARTICLE: "文章",
      DYNAMIC_TYPE_FORWARD: "转发",
      DYNAMIC_TYPE_LIVE_RCMD: "直播",
    };

    // 根据聊天类型初始化数据
    let chatType = this.e.isGroup ? "group" : "private";
    let chatId = this.e.isGroup ? this.e.group_id : this.e.user_id;

    if (!subData[chatType][chatId]) {
      subData[chatType][chatId] = [];
    }

    subData[chatType][chatId].forEach((item: { type: any[]; uid: any; name: any; }) => {
      const types = new Set();

      if (item.type && item.type.length) {
        item.type.forEach((typeItem: string | number) => {
          if (typeMap[typeItem]) {
            types.add(typeMap[typeItem]);
          }
        });
      }

      messages.push(
        `${item.name}：${item.uid}  ${types.size ? `[${Array.from(types).join("、")}]` : " [全部动态]"}`
      );
    });

    this.e.reply(`推送列表如下：\n${messages.join("\n")}`);
  }

  /**通过uid获取up主信息 */
  async getBilibiUserInfoByUid() {
    let uid = this.e.msg.replace(/^(#|\/)(yuki|优纪)?(b站|B站|bili|bilibili|哔哩|哔哩哔哩)(up|UP)主/g, "").trim();

    const res = await new BiliGetWebData(this.e).getBilibiUserInfoByUid(uid);

    if (res.statusText !== 'OK') {
      this.e.reply("诶嘿，出了点网络问题，等会再试试吧~");
      return;
    }

    const { code, data } = res.data || {};

    if (code === -799) {
      this.e.reply("遭遇风控：请求过于频繁，请稍后再试。");
      return;
    } else if (code === -404) {
      this.e.reply("输入的uid无效。");
      return;
    }
    const message = [
      `昵称：${data?.name}`,
      `\n性别：${data?.sex}`,
      `\n等级：${data?.level}`,
    ];

    if (data.live_room) {
      message.push(
        `\n***********\n---直播信息---`,
        `\n直播标题：${data?.live_room?.title}`,
        `\n直播房间：${data?.live_room?.roomid}`,
        `\n直播状态：${data?.live_room?.liveStatus ? "直播中" : "未开播"}`,
        `\n直播链接：${data?.live_room?.url}`,
        `\n观看人数：${data?.live_room?.watched_show?.num}人`
      );
    }
    this.e.reply(message);
  }

  /** 根据名称搜索up的uid*/
  async searchBiliUserInfoByKeyword() {
    let keyword = this.e.msg.replace(/^(#|\/)(yuki|优纪)?搜索(b站|B站|bili|bilibili|哔哩|哔哩哔哩)(up|UP)主/g, "").trim();

    const res = await new BiliGetWebData(this.e).searchBiliUserInfoByKeyword(keyword);

    if (res.statusText !== 'OK') {
      this.e.reply("诶嘿，出了点网络问题，等会再试试吧~");
      return;
    }

    const { code, data } = await res.data || {};

    if (code !== 0 || !data.result) {
      this.e.reply("哦豁~没有搜索到该用户捏，请换个关键词试试吧~");
      return;
    }

    const messages = [];

    data.data.result.map((item: { uname: any; mid: any; fans: any; }, index: number) => {
      if (index < 5) {
        messages.push(`${item.uname}\nUID：${item.mid}\n粉丝数：${item.fans}${index < 4 ? "\n" : ""}`);
      }
      return item;
    });

    this.e.reply(messages.join("\n"));
  }
}

