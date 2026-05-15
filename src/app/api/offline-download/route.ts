/**
 * 離線下載任務管理 API
 */

import * as fs from 'fs';
import { NextRequest, NextResponse } from 'next/server';
import * as path from 'path';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { OfflineDownloader, OfflineDownloadTask } from '@/lib/offline-downloader';

// 檢查是否啟用離線下載功能
const OFFLINE_DOWNLOAD_ENABLED = process.env.NEXT_PUBLIC_ENABLE_OFFLINE_DOWNLOAD === 'true';
const OFFLINE_DOWNLOAD_DIR = process.env.OFFLINE_DOWNLOAD_DIR || '/data';

// 全局下載器實例
let downloader: OfflineDownloader | null = null;

// 任務存儲（內存中）
const tasks = new Map<string, OfflineDownloadTask>();

// 活躍的下載Promise
const activeDownloads = new Map<string, Promise<void>>();

// 任務持久化文件路徑
const TASKS_FILE = path.join(OFFLINE_DOWNLOAD_DIR, 'tasks.json');

/**
 * 保存任務到文件
 */
function saveTasks(): void {
  try {
    const tasksArray = Array.from(tasks.values()).map((task) => ({
      ...task,
      createdAt: task.createdAt.toISOString(),
      updatedAt: task.updatedAt.toISOString(),
    }));

    // 確保目錄存在
    const dir = path.dirname(TASKS_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(TASKS_FILE, JSON.stringify(tasksArray, null, 2), 'utf-8');
  } catch (error) {
    console.error('保存任務失敗:', error);
  }
}

/**
 * 從文件加載任務
 */
function loadTasks(): void {
  try {
    console.log('嘗試加載任務文件:', TASKS_FILE);

    if (!fs.existsSync(TASKS_FILE)) {
      console.log('任務文件不存在:', TASKS_FILE);
      return;
    }

    const content = fs.readFileSync(TASKS_FILE, 'utf-8');
    const tasksArray = JSON.parse(content);
    console.log(`從文件讀取到 ${tasksArray.length} 個任務`);

    for (const taskData of tasksArray) {
      const task: OfflineDownloadTask = {
        ...taskData,
        createdAt: new Date(taskData.createdAt),
        updatedAt: new Date(taskData.updatedAt),
      };

      // 如果任務在下載或等待中，說明服務器重啟了，將狀態改為暫停
      if (task.status === 'downloading' || task.status === 'pending') {
        task.status = 'paused';
        task.errorMessage = '服務器重啟，任務已暫停';
      }

      tasks.set(task.id, task);
    }

    console.log(`已加載 ${tasks.size} 個離線下載任務到內存`);
  } catch (error) {
    console.error('加載任務失敗:', error);
  }
}

function getDownloader(): OfflineDownloader {
  if (!downloader) {
    downloader = new OfflineDownloader(OFFLINE_DOWNLOAD_DIR);
    // 首次初始化時加載已保存的任務
    loadTasks();
  }
  return downloader;
}

/**
 * 檢查用戶權限（僅管理員和站長）
 */
function checkPermission(request: NextRequest): boolean {
  if (!OFFLINE_DOWNLOAD_ENABLED) {
    return false;
  }

  const authInfo = getAuthInfoFromCookie(request);
  if (!authInfo || !authInfo.username) {
    return false;
  }

  // 只有管理員和站長可以使用
  return authInfo.role === 'owner' || authInfo.role === 'admin';
}

/**
 * GET - 獲取任務列表或檢查下載狀態
 */
export async function GET(request: NextRequest) {
  if (!checkPermission(request)) {
    return NextResponse.json({ error: '無權限' }, { status: 403 });
  }

  // 確保下載器已初始化（這會觸發任務加載）
  getDownloader();

  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');

  // 檢查視頻是否已下載
  if (action === 'check') {
    const source = searchParams.get('source');
    const videoId = searchParams.get('videoId');
    const episodeIndex = searchParams.get('episodeIndex');

    if (!source || !videoId || episodeIndex === null) {
      return NextResponse.json({ error: '參數不完整' }, { status: 400 });
    }

    const downloader = getDownloader();
    const downloaded = downloader.checkDownloaded(source, videoId, parseInt(episodeIndex));

    return NextResponse.json({ downloaded });
  }

  // 獲取所有任務列表
  const taskList = Array.from(tasks.values()).map((task) => ({
    ...task,
    // 轉換 Date 對象為 ISO 字符串
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
  }));

  return NextResponse.json({ tasks: taskList });
}

/**
 * POST - 創建離線下載任務
 */
export async function POST(request: NextRequest) {
  if (!checkPermission(request)) {
    return NextResponse.json({ error: '無權限' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const { source, videoId, episodeIndex, title, m3u8Url, metadata } = body;

    if (!source || !videoId || episodeIndex === undefined || !title || !m3u8Url) {
      return NextResponse.json({ error: '參數不完整' }, { status: 400 });
    }

    const downloader = getDownloader();

    // 1. 首先檢查是否已經有相同的任務（任何狀態）
    const existingTask = Array.from(tasks.values()).find(
      (t) =>
        t.source === source &&
        t.videoId === videoId &&
        t.episodeIndex === episodeIndex
    );

    if (existingTask) {
      // 如果任務正在下載或等待中，不允許重複創建
      if (existingTask.status === 'downloading' || existingTask.status === 'pending') {
        return NextResponse.json(
          {
            task: {
              ...existingTask,
              createdAt: existingTask.createdAt.toISOString(),
              updatedAt: existingTask.updatedAt.toISOString(),
            },
            message: '該任務正在下載中，請勿重複添加',
          },
          { status: 400 }
        );
      }

      // 如果任務已完成，不允許重複創建
      if (existingTask.status === 'completed') {
        return NextResponse.json(
          {
            task: {
              ...existingTask,
              createdAt: existingTask.createdAt.toISOString(),
              updatedAt: existingTask.updatedAt.toISOString(),
            },
            message: '該視頻已下載完成，如需重新下載請先刪除任務',
          },
          { status: 400 }
        );
      }

      // 如果任務處於錯誤或暫停狀態，提示用戶使用重試功能
      if (existingTask.status === 'error' || existingTask.status === 'paused') {
        return NextResponse.json(
          {
            task: {
              ...existingTask,
              createdAt: existingTask.createdAt.toISOString(),
              updatedAt: existingTask.updatedAt.toISOString(),
            },
            message: '該任務已存在但未完成，請使用重試功能繼續下載',
          },
          { status: 400 }
        );
      }
    }

    // 2. 檢查文件系統中是否已下載完成（防止任務被刪除但文件還在的情況）
    const downloaded = downloader.checkDownloaded(source, videoId, episodeIndex);
    if (downloaded) {
      return NextResponse.json(
        {
          message: '該視頻文件已存在，無需重複下載',
          downloaded: true,
        },
        { status: 400 }
      );
    }

    // 創建新任務
    const task = await downloader.createTask(source, videoId, episodeIndex, title, m3u8Url, metadata);
    tasks.set(task.id, task);
    saveTasks(); // 持久化任務

    // 開始下載（異步）
    const downloadPromise = downloader
      .startDownload(task, (updatedTask) => {
        // 更新任務狀態
        tasks.set(updatedTask.id, updatedTask);
        saveTasks(); // 持久化任務
      })
      .catch((error) => {
        console.error('下載失敗:', error);
        task.status = 'error';
        task.errorMessage = error.message;
        tasks.set(task.id, task);
        saveTasks(); // 持久化任務
      })
      .finally(() => {
        // 下載完成後，從活躍下載列表中移除
        activeDownloads.delete(task.id);
      });

    activeDownloads.set(task.id, downloadPromise);

    return NextResponse.json({
      task: {
        ...task,
        createdAt: task.createdAt.toISOString(),
        updatedAt: task.updatedAt.toISOString(),
      },
      message: '任務已創建',
    });
  } catch (error) {
    console.error('創建任務失敗:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '創建任務失敗' },
      { status: 500 }
    );
  }
}

/**
 * DELETE - 刪除任務
 */
export async function DELETE(request: NextRequest) {
  if (!checkPermission(request)) {
    return NextResponse.json({ error: '無權限' }, { status: 403 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const taskId = searchParams.get('taskId');

    if (!taskId) {
      return NextResponse.json({ error: '缺少任務ID' }, { status: 400 });
    }

    const task = tasks.get(taskId);
    if (!task) {
      return NextResponse.json({ error: '任務不存在' }, { status: 404 });
    }

    const downloader = getDownloader();

    // 如果任務正在下載，先標記為取消狀態，等待下載停止
    const downloadPromise = activeDownloads.get(taskId);
    if (downloadPromise) {
      // 將任務狀態設置為 error，這樣下載器會停止下載
      task.status = 'error';
      task.errorMessage = '任務已被刪除';
      tasks.set(taskId, task);

      // 從活躍下載列表中移除
      activeDownloads.delete(taskId);

      // 等待一小段時間，讓下載操作有機會停止
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    // 刪除文件
    await downloader.deleteTask(task);

    // 從任務列表中移除
    tasks.delete(taskId);
    saveTasks(); // 持久化任務

    return NextResponse.json({ message: '任務已刪除' });
  } catch (error) {
    console.error('刪除任務失敗:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '刪除任務失敗' },
      { status: 500 }
    );
  }
}

/**
 * PUT - 重試任務
 */
export async function PUT(request: NextRequest) {
  if (!checkPermission(request)) {
    return NextResponse.json({ error: '無權限' }, { status: 403 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const taskId = searchParams.get('taskId');
    const action = searchParams.get('action');

    if (!taskId) {
      return NextResponse.json({ error: '缺少任務ID' }, { status: 400 });
    }

    if (action !== 'retry') {
      return NextResponse.json({ error: '無效的操作' }, { status: 400 });
    }

    const task = tasks.get(taskId);
    if (!task) {
      return NextResponse.json({ error: '任務不存在' }, { status: 404 });
    }

    // 檢查任務狀態，只有錯誤、暫停或完成狀態可以重試
    if (task.status === 'downloading' || task.status === 'pending') {
      return NextResponse.json({ error: '任務正在進行中，無法重試' }, { status: 400 });
    }

    // 檢查是否已經在重試中
    if (activeDownloads.has(taskId)) {
      return NextResponse.json({ error: '任務已在重試中' }, { status: 400 });
    }

    const downloader = getDownloader();

    // 重置任務狀態（保留已下載的進度，只重試失敗的片段）
    task.status = 'pending';
    // 不重置 progress 和 downloadedSegments，讓下載器自動跳過已下載的片段
    task.errorMessage = undefined;
    task.updatedAt = new Date();
    tasks.set(taskId, task);
    saveTasks(); // 持久化任務

    // 開始重新下載（異步）
    const downloadPromise = downloader
      .startDownload(task, (updatedTask) => {
        // 更新任務狀態
        tasks.set(updatedTask.id, updatedTask);
        saveTasks(); // 持久化任務
      })
      .catch((error) => {
        console.error('重試下載失敗:', error);
        task.status = 'error';
        task.errorMessage = error.message;
        tasks.set(task.id, task);
        saveTasks(); // 持久化任務
      })
      .finally(() => {
        // 下載完成後，從活躍下載列表中移除
        activeDownloads.delete(task.id);
      });

    activeDownloads.set(task.id, downloadPromise);

    return NextResponse.json({
      task: {
        ...task,
        createdAt: task.createdAt.toISOString(),
        updatedAt: task.updatedAt.toISOString(),
      },
      message: '任務已重新開始',
    });
  } catch (error) {
    console.error('重試任務失敗:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '重試任務失敗' },
      { status: 500 }
    );
  }
}
