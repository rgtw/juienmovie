/* eslint-disable @typescript-eslint/no-explicit-any,no-console,@typescript-eslint/no-non-null-assertion */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { db } from '@/lib/db';
import { sanitizeFeaturePermissions } from '@/lib/feature-permissions';

export const runtime = 'nodejs';

// 支持的操作類型
const ACTIONS = [
  'add',
  'ban',
  'unban',
  'setAdmin',
  'cancelAdmin',
  'changePassword',
  'deleteUser',
  'updateUserApis',
  'userGroup',
  'updateUserGroups',
  'batchUpdateUserGroups',
] as const;

export async function POST(request: NextRequest) {
  const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';
  if (storageType === 'localstorage') {
    return NextResponse.json(
      {
        error: '不支持本地存儲進行管理員配置',
      },
      { status: 400 }
    );
  }

  try {
    const body = await request.json();

    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const username = authInfo.username;

    const {
      targetUsername, // 目標用戶名
      targetPassword, // 目標用戶密碼（僅在添加用戶時需要）
      action,
    } = body as {
      targetUsername?: string;
      targetPassword?: string;
      action?: (typeof ACTIONS)[number];
    };

    if (!action || !ACTIONS.includes(action)) {
      return NextResponse.json({ error: '參數格式錯誤' }, { status: 400 });
    }

    // 用戶組操作和批量操作不需要targetUsername
    if (!targetUsername && !['userGroup', 'batchUpdateUserGroups'].includes(action)) {
      return NextResponse.json({ error: '缺少目標用戶名' }, { status: 400 });
    }

    if (
      action !== 'changePassword' &&
      action !== 'deleteUser' &&
      action !== 'updateUserApis' &&
      action !== 'userGroup' &&
      action !== 'updateUserGroups' &&
      action !== 'batchUpdateUserGroups' &&
      username === targetUsername
    ) {
      return NextResponse.json(
        { error: '無法對自己進行此操作' },
        { status: 400 }
      );
    }

    // 獲取配置與存儲
    const adminConfig = await getConfig();

    // 判定操作者角色
    let operatorRole: 'owner' | 'admin';
    if (username === process.env.USERNAME) {
      operatorRole = 'owner';
    } else {
      // 優先從新版本獲取用戶信息
      const operatorInfo = await db.getUserInfoV2(username);
      if (operatorInfo) {
        if (operatorInfo.role !== 'admin' || operatorInfo.banned) {
          return NextResponse.json({ error: '權限不足' }, { status: 401 });
        }
        operatorRole = 'admin';
      } else {
        // 回退到配置中查找
        const userEntry = adminConfig.UserConfig.Users.find(
          (u) => u.username === username
        );
        if (!userEntry || userEntry.role !== 'admin' || userEntry.banned) {
          return NextResponse.json({ error: '權限不足' }, { status: 401 });
        }
        operatorRole = 'admin';
      }
    }

    // 查找目標用戶條目（用戶組操作和批量操作不需要）
    let targetEntry: any = null;
    let isTargetAdmin = false;
    let targetUserV2: any = null;

    if (!['userGroup', 'batchUpdateUserGroups'].includes(action) && targetUsername) {
      // 先從配置中查找
      targetEntry = adminConfig.UserConfig.Users.find(
        (u) => u.username === targetUsername
      );

      // 如果配置中沒有，從新版本存儲中查找
      if (!targetEntry) {
        targetUserV2 = await db.getUserInfoV2(targetUsername);
        if (targetUserV2) {
          // 構造一個兼容的targetEntry對象
          targetEntry = {
            username: targetUsername,
            role: targetUserV2.role,
            banned: targetUserV2.banned,
            tags: targetUserV2.tags,
          };
        }
      }

      if (
        targetEntry &&
        targetEntry.role === 'owner' &&
        !['changePassword', 'updateUserApis', 'updateUserGroups'].includes(action)
      ) {
        return NextResponse.json({ error: '無法操作站長' }, { status: 400 });
      }

      // 權限校驗邏輯
      isTargetAdmin = targetEntry?.role === 'admin';
    }

    switch (action) {
      case 'add': {
        if (targetEntry) {
          return NextResponse.json({ error: '用戶已存在' }, { status: 400 });
        }
        // 檢查新版本中是否已存在
        const existsV2 = await db.checkUserExistV2(targetUsername!);
        if (existsV2) {
          return NextResponse.json({ error: '用戶已存在' }, { status: 400 });
        }
        if (!targetPassword) {
          return NextResponse.json(
            { error: '缺少目標用戶密碼' },
            { status: 400 }
          );
        }

        // 獲取用戶組信息
        const { userGroup } = body as { userGroup?: string };
        const tags = userGroup && userGroup.trim() ? [userGroup] : undefined;

        // 使用新版本創建用戶
        await db.createUserV2(targetUsername!, targetPassword, 'user', tags);

        // 不再更新配置，因為用戶已經存儲在新版本中
        // 構造一個虛擬的targetEntry用於後續邏輯
        targetEntry = {
          username: targetUsername!,
          role: 'user',
          tags,
        };
        break;
      }
      case 'ban': {
        if (!targetEntry) {
          return NextResponse.json(
            { error: '目標用戶不存在' },
            { status: 404 }
          );
        }
        if (isTargetAdmin) {
          // 目標是管理員
          if (operatorRole !== 'owner') {
            return NextResponse.json(
              { error: '僅站長可封禁管理員' },
              { status: 401 }
            );
          }
        }

        // 只更新V2存儲
        await db.updateUserInfoV2(targetUsername!, { banned: true });
        break;
      }
      case 'unban': {
        if (!targetEntry) {
          return NextResponse.json(
            { error: '目標用戶不存在' },
            { status: 404 }
          );
        }
        if (isTargetAdmin) {
          if (operatorRole !== 'owner') {
            return NextResponse.json(
              { error: '僅站長可操作管理員' },
              { status: 401 }
            );
          }
        }

        // 只更新V2存儲
        await db.updateUserInfoV2(targetUsername!, { banned: false });
        break;
      }
      case 'setAdmin': {
        if (!targetEntry) {
          return NextResponse.json(
            { error: '目標用戶不存在' },
            { status: 404 }
          );
        }
        if (targetEntry.role === 'admin') {
          return NextResponse.json(
            { error: '該用戶已是管理員' },
            { status: 400 }
          );
        }
        if (operatorRole !== 'owner') {
          return NextResponse.json(
            { error: '僅站長可設置管理員' },
            { status: 401 }
          );
        }

        // 只更新V2存儲
        await db.updateUserInfoV2(targetUsername!, { role: 'admin' });
        break;
      }
      case 'cancelAdmin': {
        if (!targetEntry) {
          return NextResponse.json(
            { error: '目標用戶不存在' },
            { status: 404 }
          );
        }
        if (targetEntry.role !== 'admin') {
          return NextResponse.json(
            { error: '目標用戶不是管理員' },
            { status: 400 }
          );
        }
        if (operatorRole !== 'owner') {
          return NextResponse.json(
            { error: '僅站長可取消管理員' },
            { status: 401 }
          );
        }

        // 只更新V2存儲
        await db.updateUserInfoV2(targetUsername!, { role: 'user' });
        break;
      }
      case 'changePassword': {
        if (!targetEntry) {
          return NextResponse.json(
            { error: '目標用戶不存在' },
            { status: 404 }
          );
        }
        if (!targetPassword) {
          return NextResponse.json({ error: '缺少新密碼' }, { status: 400 });
        }

        // 權限檢查：不允許修改站長密碼
        if (targetEntry.role === 'owner') {
          return NextResponse.json(
            { error: '無法修改站長密碼' },
            { status: 401 }
          );
        }

        if (
          isTargetAdmin &&
          operatorRole !== 'owner' &&
          username !== targetUsername
        ) {
          return NextResponse.json(
            { error: '僅站長可修改其他管理員密碼' },
            { status: 401 }
          );
        }

        // 使用新版本修改密碼（SHA256加密）
        await db.changePasswordV2(targetUsername!, targetPassword);
        break;
      }
      case 'deleteUser': {
        if (!targetEntry) {
          return NextResponse.json(
            { error: '目標用戶不存在' },
            { status: 404 }
          );
        }

        // 權限檢查：站長可刪除所有用戶（除了自己），管理員可刪除普通用戶
        if (username === targetUsername) {
          return NextResponse.json(
            { error: '不能刪除自己' },
            { status: 400 }
          );
        }

        if (isTargetAdmin && operatorRole !== 'owner') {
          return NextResponse.json(
            { error: '僅站長可刪除管理員' },
            { status: 401 }
          );
        }

        // 只刪除V2存儲中的用戶
        await db.deleteUserV2(targetUsername!);

        break;
      }
      case 'updateUserApis': {
        if (!targetEntry) {
          return NextResponse.json(
            { error: '目標用戶不存在' },
            { status: 404 }
          );
        }

        const { enabledApis } = body as { enabledApis?: string[] };

        // 權限檢查：站長可配置所有人的採集源，管理員可配置普通用戶和自己的採集源
        if (
          isTargetAdmin &&
          operatorRole !== 'owner' &&
          username !== targetUsername
        ) {
          return NextResponse.json(
            { error: '僅站長可配置其他管理員的採集源' },
            { status: 401 }
          );
        }

        // 更新V2存儲中的採集源權限
        await db.updateUserInfoV2(targetUsername!, {
          enabledApis: enabledApis && enabledApis.length > 0 ? enabledApis : []
        });

        break;
      }
      case 'userGroup': {
        // 用戶組管理操作
        const { groupAction, groupName, enabledApis, permissions } = body as {
          groupAction: 'add' | 'edit' | 'delete';
          groupName: string;
          enabledApis?: string[];
          permissions?: string[];
        };
        const normalizedPermissions = sanitizeFeaturePermissions(permissions);

        if (!adminConfig.UserConfig.Tags) {
          adminConfig.UserConfig.Tags = [];
        }

        switch (groupAction) {
          case 'add': {
            // 檢查用戶組是否已存在
            if (adminConfig.UserConfig.Tags.find(t => t.name === groupName)) {
              return NextResponse.json({ error: '用戶組已存在' }, { status: 400 });
            }
            adminConfig.UserConfig.Tags.push({
              name: groupName,
              enabledApis: enabledApis || [],
              permissions: normalizedPermissions,
            });
            break;
          }
          case 'edit': {
            const groupIndex = adminConfig.UserConfig.Tags.findIndex(t => t.name === groupName);
            if (groupIndex === -1) {
              return NextResponse.json({ error: '用戶組不存在' }, { status: 404 });
            }
            adminConfig.UserConfig.Tags[groupIndex].enabledApis = enabledApis || [];
            adminConfig.UserConfig.Tags[groupIndex].permissions = normalizedPermissions;
            break;
          }
          case 'delete': {
            const groupIndex = adminConfig.UserConfig.Tags.findIndex(t => t.name === groupName);
            if (groupIndex === -1) {
              return NextResponse.json({ error: '用戶組不存在' }, { status: 404 });
            }

            // 查找使用該用戶組的所有用戶（從V2存儲中查找）
            const affectedUsers = await db.getUsersByTag(groupName);

            // 從用戶的tags中移除該用戶組
            for (const username of affectedUsers) {
              const userInfo = await db.getUserInfoV2(username);
              if (userInfo && userInfo.tags) {
                const newTags = userInfo.tags.filter(tag => tag !== groupName);
                await db.updateUserInfoV2(username, { tags: newTags });
              }
            }

            // 刪除用戶組
            adminConfig.UserConfig.Tags.splice(groupIndex, 1);

            // 記錄刪除操作的影響
            console.log(`刪除用戶組 "${groupName}"，影響用戶: ${affectedUsers.length > 0 ? affectedUsers.join(', ') : '無'}`);

            break;
          }
          default:
            return NextResponse.json({ error: '未知的用戶組操作' }, { status: 400 });
        }
        break;
      }
      case 'updateUserGroups': {
        if (!targetEntry) {
          return NextResponse.json({ error: '目標用戶不存在' }, { status: 404 });
        }

        const { userGroups } = body as { userGroups: string[] };

        // 權限檢查：站長可配置所有人的用戶組，管理員可配置普通用戶和自己的用戶組
        if (
          isTargetAdmin &&
          operatorRole !== 'owner' &&
          username !== targetUsername
        ) {
          return NextResponse.json({ error: '僅站長可配置其他管理員的用戶組' }, { status: 400 });
        }

        // 更新用戶的用戶組
        if (userGroups && userGroups.length > 0) {
          // 只更新V2存儲
          await db.updateUserInfoV2(targetUsername!, { tags: userGroups });
        } else {
          // 如果為空數組或未提供，則刪除該字段，表示無用戶組
          await db.updateUserInfoV2(targetUsername!, { tags: [] });
        }

        break;
      }
      case 'batchUpdateUserGroups': {
        const { usernames, userGroups } = body as { usernames: string[]; userGroups: string[] };

        if (!usernames || !Array.isArray(usernames) || usernames.length === 0) {
          return NextResponse.json({ error: '缺少用戶名列表' }, { status: 400 });
        }

        // 權限檢查：站長可批量配置所有人的用戶組，管理員只能批量配置普通用戶
        if (operatorRole !== 'owner') {
          for (const targetUsername of usernames) {
            // 從V2存儲中查找用戶
            const userV2 = await db.getUserInfoV2(targetUsername);
            if (userV2 && userV2.role === 'admin' && targetUsername !== username) {
              return NextResponse.json({ error: `管理員無法操作其他管理員 ${targetUsername}` }, { status: 400 });
            }
          }
        }

        // 批量更新用戶組
        for (const targetUsername of usernames) {
          // 只更新V2存儲
          if (userGroups && userGroups.length > 0) {
            await db.updateUserInfoV2(targetUsername, { tags: userGroups });
          } else {
            await db.updateUserInfoV2(targetUsername, { tags: [] });
          }
        }

        break;
      }
      default:
        return NextResponse.json({ error: '未知操作' }, { status: 400 });
    }

    // 將更新後的配置寫入數據庫
    await db.saveAdminConfig(adminConfig);

    return NextResponse.json(
      { ok: true },
      {
        headers: {
          'Cache-Control': 'no-store', // 管理員配置不緩存
        },
      }
    );
  } catch (error) {
    console.error('用戶管理操作失敗:', error);
    return NextResponse.json(
      {
        error: '用戶管理操作失敗',
        details: (error as Error).message,
      },
      { status: 500 }
    );
  }
}
