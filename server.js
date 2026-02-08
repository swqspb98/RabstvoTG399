import express from 'express';
import TelegramBot from 'node-telegram-bot-api';
import sqlite3 from 'sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
app.use(express.json());
app.use(express.static('public'));

// ===== НАСТРОЙКИ =====
const BOT_TOKEN = '8538468707:AAFkv0zojKMIAdYQjl-AWWvghTz3TSXsp8c'; // Получи у @BotFather
const PORT = process.env.PORT || 3000;

// ===== БАЗА ДАННЫХ =====
const db = new sqlite3.Database('game.db');

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      first_name TEXT,
      username TEXT,
      balance INTEGER DEFAULT 100,
      energy INTEGER DEFAULT 100,
      level INTEGER DEFAULT 1,
      current_master_id INTEGER DEFAULT 999999
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      master_id INTEGER,
      title TEXT,
      description TEXT,
      status TEXT DEFAULT 'assigned',
      proof TEXT,
      reward INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Создаем системного хозяина
  db.run(`INSERT OR IGNORE INTO users (id, first_name, username) VALUES (999999, 'Система', 'system')`);
});

// ===== TELEGRAM БОТ =====
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const gameUrl = process.env.NODE_ENV === 'production' 
    ? 'https://ваш-домен.herokuapp.com'
    : `http://localhost:${PORT}`;
  
  bot.sendMessage(chatId, '🎮 Добро пожаловать в Slave 2.0!', {
    reply_markup: {
      inline_keyboard: [[
        { text: '▶️ Открыть игру', web_app: { url: gameUrl } }
      ]]
    }
  });
});

bot.onText(/\/game/, (msg) => {
  const gameUrl = process.env.NODE_ENV === 'production'
    ? 'https://ваш-домен.herokuapp.com'
    : `http://localhost:${PORT}`;
  
  bot.sendMessage(msg.chat.id, 'Нажмите кнопку чтобы открыть игру:', {
    reply_markup: {
      inline_keyboard: [[
        { text: '🎮 Открыть игру', web_app: { url: gameUrl } }
      ]]
    }
  });
});

// Уведомления
function sendNotification(userId, message) {
  db.get('SELECT username FROM users WHERE id = ?', [userId], (err, user) => {
    if (user && user.username) {
      bot.sendMessage(user.username, message).catch(err => {
        console.log('Не удалось отправить уведомление:', err.message);
      });
    }
  });
}

// ===== API РОУТЫ =====

// 1. Главная страница
app.get('/', (req, res) => {
  res.sendFile(join(__dirname, 'public', 'index.html'));
});

// 2. Авторизация
app.post('/api/auth', (req, res) => {
  const { initData, user } = req.body;
  
  if (!user || !user.id) {
    return res.json({ error: 'Нет данных пользователя' });
  }
  
  const { id, first_name, username } = user;
  
  db.get('SELECT * FROM users WHERE id = ?', [id], (err, existingUser) => {
    if (err) {
      console.error(err);
      return res.json({ error: 'Ошибка базы данных' });
    }
    
    if (!existingUser) {
      // Новый пользователь
      db.run(
        'INSERT INTO users (id, first_name, username) VALUES (?, ?, ?)',
        [id, first_name, username],
        (err) => {
          if (err) console.error(err);
        }
      );
      
      // Создаем первое задание
      const firstTasks = [
        "Поставь реакцию ❤️ на 3 постах в нашем канале",
        "Найди и пришли смешной стикер",
        "Расскажи анекдот в комментариях"
      ];
      
      const randomTask = firstTasks[Math.floor(Math.random() * firstTasks.length)];
      
      db.run(
        'INSERT INTO tasks (user_id, master_id, title, description) VALUES (?, ?, ?, ?)',
        [id, 999999, 'Первое задание', randomTask],
        (err) => {
          if (err) console.error(err);
        }
      );
      
      res.json({
        user: {
          id, first_name, username,
          balance: 100, energy: 100, level: 1,
          current_master_id: 999999
        }
      });
    } else {
      res.json({ user: existingUser });
    }
  });
});

// 3. Получить профиль
app.get('/api/profile/:userId', (req, res) => {
  const userId = req.params.userId;
  
  db.get('SELECT * FROM users WHERE id = ?', [userId], (err, user) => {
    if (err || !user) {
      return res.json({ error: 'Пользователь не найден' });
    }
    
    // Получаем хозяина
    db.get('SELECT * FROM users WHERE id = ?', [user.current_master_id], (err, master) => {
      res.json({
        user: {
          ...user,
          master: master || { id: 999999, first_name: 'Система' }
        }
      });
    });
  });
});

// 4. Получить задания пользователя
app.get('/api/tasks/:userId', (req, res) => {
  const userId = req.params.userId;
  
  db.all(
    `SELECT t.*, u.first_name as master_name 
     FROM tasks t 
     LEFT JOIN users u ON t.master_id = u.id 
     WHERE t.user_id = ? AND t.status = 'assigned' 
     ORDER BY t.created_at DESC`,
    [userId],
    (err, tasks) => {
      if (err) {
        return res.json({ error: 'Ошибка базы данных' });
      }
      res.json({ tasks });
    }
  );
});

// 5. Создать задание
app.post('/api/tasks', (req, res) => {
  const { master_id, user_id, title, description } = req.body;
  
  const taskTypes = [
    { title: "Поставить реакцию ❤️", desc: "Поставь реакцию ❤️ на 3 последних постах в нашем канале" },
    { title: "Найти стикер-пак", desc: "Найди и пришли ссылку на смешной стикер-пак" },
    { title: "Сделать репост", desc: "Сделай репост последнего поста в свой личный чат" },
    { title: "Написать комментарий", desc: "Напиши комментарий под нашим последним постом" },
    { title: "Пригласить друга", desc: "Пригласи друга в игру" }
  ];
  
  const task = taskTypes[Math.floor(Math.random() * taskTypes.length)];
  
  db.run(
    'INSERT INTO tasks (user_id, master_id, title, description) VALUES (?, ?, ?, ?)',
    [user_id, master_id, task.title, task.desc],
    function(err) {
      if (err) {
        console.error(err);
        return res.json({ error: 'Ошибка создания задания' });
      }
      
      // Отправляем уведомление
      sendNotification(user_id, `🎯 Новое задание от хозяина!\n\n${task.title}\n\nОткрой игру чтобы выполнить.`);
      
      res.json({ success: true, taskId: this.lastID });
    }
  );
});

// 6. Выполнить задание
app.post('/api/tasks/:taskId/complete', (req, res) => {
  const { taskId } = req.params;
  const { proof } = req.body;
  
  db.run(
    'UPDATE tasks SET status = ?, proof = ? WHERE id = ?',
    ['completed', proof, taskId],
    (err) => {
      if (err) {
        console.error(err);
        return res.json({ error: 'Ошибка' });
      }
      
      // Получаем задание чтобы уведомить хозяина
      db.get('SELECT * FROM tasks WHERE id = ?', [taskId], (err, task) => {
        if (task) {
          sendNotification(task.master_id, 
            `✅ Твой раб выполнил задание!\n\n` +
            `Задание: ${task.title}\n` +
            `Доказательство: ${proof}\n\n` +
            `Открой игру чтобы проверить.`
          );
        }
      });
      
      res.json({ success: true });
    }
  );
});

// 7. Подтвердить задание
app.post('/api/tasks/:taskId/approve', (req, res) => {
  const { taskId } = req.params;
  
  const reward = Math.floor(Math.random() * 41) + 10;
  const commission = Math.floor(reward * 0.1);
  
  // Получаем задание
  db.get('SELECT * FROM tasks WHERE id = ?', [taskId], (err, task) => {
    if (err || !task) {
      return res.json({ error: 'Задание не найдено' });
    }
    
    // Обновляем задание
    db.run(
      'UPDATE tasks SET status = ?, reward = ? WHERE id = ?',
      ['approved', reward, taskId],
      (err) => {
        if (err) {
          console.error(err);
          return res.json({ error: 'Ошибка' });
        }
        
        // Начисляем рабу
        db.run(
          'UPDATE users SET balance = balance + ? WHERE id = ?',
          [reward, task.user_id]
        );
        
        // Начисляем хозяину комиссию
        db.run(
          'UPDATE users SET balance = balance + ? WHERE id = ?',
          [commission, task.master_id]
        );
        
        // Уведомляем раба
        sendNotification(task.user_id, `💰 Задание выполнено! Ты получил ${reward} монет.`);
        
        res.json({ 
          success: true, 
          reward: reward, 
          commission: commission 
        });
      }
    );
  });
});

// 8. Получить рабов
app.get('/api/slaves/:masterId', (req, res) => {
  const masterId = req.params.masterId;
  
  db.all(
    'SELECT * FROM users WHERE current_master_id = ?',
    [masterId],
    (err, slaves) => {
      if (err) {
        return res.json({ error: 'Ошибка базы данных' });
      }
      res.json({ slaves });
    }
  );
});

// 9. Топ игроков
app.get('/api/top', (req, res) => {
  db.all(
    'SELECT id, first_name, username, balance, level FROM users WHERE id != 999999 ORDER BY balance DESC LIMIT 10',
    (err, players) => {
      if (err) {
        return res.json({ error: 'Ошибка базы данных' });
      }
      res.json({ players });
    }
  );
});

// 10. Обновить баланс
app.post('/api/update-balance', (req, res) => {
  const { userId, amount } = req.body;
  
  db.run(
    'UPDATE users SET balance = balance + ? WHERE id = ?',
    [amount, userId],
    (err) => {
      if (err) {
        return res.json({ error: 'Ошибка' });
      }
      
      db.get('SELECT balance FROM users WHERE id = ?', [userId], (err, user) => {
        res.json({ success: true, balance: user.balance });
      });
    }
  );
});

// ===== ЗАПУСК СЕРВЕРА =====
app.listen(PORT, () => {
  console.log(`🚀 Сервер запущен на порту ${PORT}`);
  console.log(`🌐 Открой в браузере: http://localhost:${PORT}`);
  console.log(`🤖 Бот запущен, используй /start в Telegram`);
});
