import express from 'express';
import TelegramBot from 'node-telegram-bot-api';
import sqlite3 from 'sqlite3';
import { createHash } from 'crypto';

const app = express();
app.use(express.json());
app.use(express.static('public'));

// ===== НАСТРОЙКИ =====
const BOT_TOKEN = '8538468707:AAFkv0zojKMIAdYQjl-AWWvghTz3TSXsp8c'; // Получи у @BotFather
const PORT = 3000;

// ===== БАЗА ДАННЫХ =====
const db = new sqlite3.Database(':memory:'); // Используем память для простоты

// Создаем таблицы
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      first_name TEXT,
      username TEXT,
      balance INTEGER DEFAULT 100,
      energy INTEGER DEFAULT 100,
      level INTEGER DEFAULT 1,
      current_master_id INTEGER
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

  // Добавляем несколько тестовых заданий
  db.run(`INSERT OR IGNORE INTO users (id, first_name, username) VALUES (999999, 'Система', 'system')`);
});

// ===== TELEGRAM БОТ =====
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, '🎮 Добро пожаловать в Slave 2.0!', {
    reply_markup: {
      inline_keyboard: [[
        { text: 'Открыть игру', web_app: { url: `http://localhost:${PORT}` } }
      ]]
    }
  });
});

// ===== API ДЛЯ МИНИ-АППА =====

// 1. Авторизация
app.post('/api/auth', (req, res) => {
  const { initData, user } = req.body;
  
  // Простая проверка (в реальном приложении нужна полноценная проверка подписи)
  if (!user || !user.id) {
    return res.json({ error: 'Нет данных пользователя' });
  }
  
  const { id, first_name, username } = user;
  
  // Сохраняем пользователя в базе
  db.get('SELECT * FROM users WHERE id = ?', [id], (err, existingUser) => {
    if (err) {
      console.error(err);
      return res.json({ error: 'Ошибка базы данных' });
    }
    
    if (!existingUser) {
      // Новый пользователь
      db.run(
        'INSERT INTO users (id, first_name, username, current_master_id) VALUES (?, ?, ?, ?)',
        [id, first_name, username, 999999], // Назначаем системного хозяина
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

// 2. Получить профиль
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
          master: master || null
        }
      });
    });
  });
});

// 3. Получить задания пользователя
app.get('/api/tasks/:userId', (req, res) => {
  const userId = req.params.userId;
  
  db.all(
    'SELECT * FROM tasks WHERE user_id = ? AND status = ? ORDER BY created_at DESC',
    [userId, 'assigned'],
    (err, tasks) => {
      if (err) {
        return res.json({ error: 'Ошибка базы данных' });
      }
      res.json({ tasks });
    }
  );
});

// 4. Создать задание
app.post('/api/tasks', (req, res) => {
  const { master_id, user_id, title, description } = req.body;
  
  const taskTypes = [
    {
      title: "Поставить реакцию ❤️",
      description: "Поставь реакцию ❤️ на 3 последних постах в канале @test_channel"
    },
    {
      title: "Найти стикер-пак",
      description: "Найди и пришли ссылку на смешной стикер-пак"
    },
    {
      title: "Сделать репост",
      description: "Сделай репост последнего поста в свой личный чат"
    }
  ];
  
  const task = taskTypes[Math.floor(Math.random() * taskTypes.length)];
  
  db.run(
    'INSERT INTO tasks (user_id, master_id, title, description) VALUES (?, ?, ?, ?)',
    [user_id, master_id, task.title, task.description],
    function(err) {
      if (err) {
        console.error(err);
        return res.json({ error: 'Ошибка создания задания' });
      }
      
      // Отправляем уведомление ботом
      db.get('SELECT * FROM users WHERE id = ?', [user_id], (err, slave) => {
        if (slave && slave.username) {
          bot.sendMessage(slave.username, `🎯 Новое задание от хозяина!\n\n${task.title}\n\nОткрой игру чтобы выполнить.`);
        }
      });
      
      res.json({ success: true, taskId: this.lastID });
    }
  );
});

// 5. Выполнить задание
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
      
      // Уведомляем хозяина
      db.get('SELECT * FROM tasks WHERE id = ?', [taskId], (err, task) => {
        if (task) {
          db.get('SELECT * FROM users WHERE id = ?', [task.master_id], (err, master) => {
            if (master && master.username) {
              bot.sendMessage(master.username, `✅ Твой раб выполнил задание!\n\nПроверь доказательство: ${proof}`);
            }
          });
        }
      });
      
      res.json({ success: true });
    }
  );
});

// 6. Подтвердить задание
app.post('/api/tasks/:taskId/approve', (req, res) => {
  const { taskId } = req.params;
  
  // Случайная награда 10-50 монет
  const reward = Math.floor(Math.random() * 41) + 10;
  const commission = Math.floor(reward * 0.1);
  
  // Обновляем задание
  db.run(
    'UPDATE tasks SET status = ?, reward = ? WHERE id = ?',
    ['approved', reward, taskId],
    (err) => {
      if (err) {
        console.error(err);
        return res.json({ error: 'Ошибка' });
      }
      
      // Находим задание
      db.get('SELECT * FROM tasks WHERE id = ?', [taskId], (err, task) => {
        if (task) {
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
          db.get('SELECT * FROM users WHERE id = ?', [task.user_id], (err, slave) => {
            if (slave && slave.username) {
              bot.sendMessage(slave.username, `💰 Задание выполнено! Ты получил ${reward} монет.`);
            }
          });
        }
      });
      
      res.json({ success: true, reward, commission });
    }
  );
});

// 7. Получить рабов
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

// 8. Топ игроков
app.get('/api/top', (req, res) => {
  db.all(
    'SELECT id, first_name, username, balance, level FROM users ORDER BY balance DESC LIMIT 10',
    (err, players) => {
      if (err) {
        return res.json({ error: 'Ошибка базы данных' });
      }
      res.json({ players });
    }
  );
});

// ===== ФРОНТЕНД (HTML) =====
app.get('/', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Slave 2.0</title>
    <script src="https://telegram.org/js/telegram-web-app.js"></script>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: Arial, sans-serif; padding: 20px; background: #f5f5f5; }
        .card { background: white; border-radius: 10px; padding: 15px; margin: 10px 0; box-shadow: 0 2px 5px rgba(0,0,0,0.1); }
        .btn { background: #2481cc; color: white; border: none; padding: 10px 15px; border-radius: 5px; margin: 5px; cursor: pointer; }
        .btn:hover { background: #1a6db0; }
        .stats { display: flex; justify-content: space-between; margin: 10px 0; }
        .stat-item { text-align: center; }
        .tab { display: none; }
        .active { display: block; }
        .menu { display: flex; background: white; border-radius: 10px; margin: 10px 0; }
        .menu-btn { flex: 1; padding: 15px; text-align: center; border: none; background: none; cursor: pointer; }
        .menu-btn.active { background: #2481cc; color: white; border-radius: 10px; }
        .task { border-left: 4px solid #2481cc; margin: 10px 0; }
    </style>
</head>
<body>
    <div id="app">
        <div id="loading">Загрузка...</div>
        
        <div id="main" style="display: none;">
            <!-- Профиль -->
            <div class="card" id="profile">
                <div style="display: flex; align-items: center; gap: 10px;">
                    <div id="avatar" style="width: 50px; height: 50px; background: #ccc; border-radius: 50%;"></div>
                    <div>
                        <h3 id="userName"></h3>
                        <p id="userBalance">Баланс: 0</p>
                    </div>
                </div>
                <div class="stats">
                    <div class="stat-item">
                        <div style="font-size: 24px; color: #2481cc;" id="energy">100</div>
                        <div>Энергия</div>
                    </div>
                    <div class="stat-item">
                        <div style="font-size: 24px; color: #2481cc;" id="level">1</div>
                        <div>Уровень</div>
                    </div>
                </div>
            </div>
            
            <!-- Меню -->
            <div class="menu">
                <button class="menu-btn active" onclick="showTab('tasks')">Задания</button>
                <button class="menu-btn" onclick="showTab('slaves')">Рабы</button>
                <button class="menu-btn" onclick="showTab('top')">Топ</button>
                <button class="menu-btn" onclick="showTab('shop')">Магазин</button>
            </div>
            
            <!-- Вкладка Задания -->
            <div id="tasks" class="tab active">
                <div class="card">
                    <h3>Мои задания</h3>
                    <div id="tasksList"></div>
                </div>
            </div>
            
            <!-- Вкладка Рабы -->
            <div id="slaves" class="tab">
                <div class="card">
                    <h3>Мои рабы</h3>
                    <button class="btn" onclick="giveRandomTask()">Дать случайное задание</button>
                    <div id="slavesList"></div>
                </div>
            </div>
            
            <!-- Вкладка Топ -->
            <div id="top" class="tab">
                <div class="card">
                    <h3>Топ игроков</h3>
                    <div id="topList"></div>
                </div>
            </div>
            
            <!-- Вкладка Магазин -->
            <div id="shop" class="tab">
                <div class="card">
                    <h3>Магазин</h3>
                    <p>Скоро открытие!</p>
                </div>
            </div>
        </div>
        
        <!-- Модальное окно выполнения -->
        <div id="modal" style="display: none; position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); justify-content: center; align-items: center;">
            <div class="card" style="width: 90%; max-width: 500px;">
                <h3 id="modalTitle"></h3>
                <p id="modalDesc"></p>
                <input type="text" id="proofInput" placeholder="Ссылка или текст" style="width: 100%; padding: 10px; margin: 10px 0;">
                <button class="btn" onclick="submitTask()">Отправить</button>
                <button class="btn" onclick="closeModal()">Отмена</button>
            </div>
        </div>
    </div>
    
    <script>
        let currentUser = null;
        let currentTask = null;
        const API_URL = 'http://localhost:${PORT}/api';
        
        // Инициализация Telegram Web App
        const tg = window.Telegram.WebApp;
        tg.expand();
        tg.ready();
        
        // Авторизация
        async function init() {
            const initData = tg.initData;
            const user = tg.initDataUnsafe.user;
            
            try {
                const response = await fetch(API_URL + '/auth', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ initData, user })
                });
                
                const data = await response.json();
                if (data.user) {
                    currentUser = data.user;
                    showProfile();
                    loadTasks();
                    loadSlaves();
                    loadTop();
                    
                    document.getElementById('loading').style.display = 'none';
                    document.getElementById('main').style.display = 'block';
                }
            } catch (error) {
                console.error('Ошибка авторизации:', error);
            }
        }
        
        // Показать профиль
        function showProfile() {
            document.getElementById('userName').textContent = currentUser.first_name;
            document.getElementById('userBalance').textContent = 'Баланс: ' + currentUser.balance;
            document.getElementById('energy').textContent = currentUser.energy;
            document.getElementById('level').textContent = currentUser.level;
        }
        
        // Загрузить задания
        async function loadTasks() {
            const response = await fetch(API_URL + '/tasks/' + currentUser.id);
            const data = await response.json();
            
            const tasksList = document.getElementById('tasksList');
            tasksList.innerHTML = '';
            
            if (data.tasks && data.tasks.length > 0) {
                data.tasks.forEach(task => {
                    const taskEl = document.createElement('div');
                    taskEl.className = 'task card';
                    taskEl.innerHTML = \`
                        <h4>\${task.title}</h4>
                        <p>\${task.description}</p>
                        <button class="btn" onclick="openTaskModal(\${task.id}, '\${task.title}', '\${task.description}')">Выполнить</button>
                    \`;
                    tasksList.appendChild(taskEl);
                });
            } else {
                tasksList.innerHTML = '<p>Нет активных заданий</p>';
            }
        }
        
        // Загрузить рабов
        async function loadSlaves() {
            const response = await fetch(API_URL + '/slaves/' + currentUser.id);
            const data = await response.json();
            
            const slavesList = document.getElementById('slavesList');
            slavesList.innerHTML = '';
            
            if (data.slaves && data.slaves.length > 0) {
                data.slaves.forEach(slave => {
                    const slaveEl = document.createElement('div');
                    slaveEl.className = 'card';
                    slaveEl.innerHTML = \`
                        <div style="display: flex; justify-content: space-between;">
                            <div>
                                <strong>\${slave.first_name}</strong>
                                \${slave.username ? '@' + slave.username : ''}
                            </div>
                            <div>\${slave.balance} монет</div>
                        </div>
                    \`;
                    slavesList.appendChild(slaveEl);
                });
            } else {
                slavesList.innerHTML = '<p>У вас пока нет рабов</p>';
            }
        }
        
        // Загрузить топ
        async function loadTop() {
            const response = await fetch(API_URL + '/top');
            const data = await response.json();
            
            const topList = document.getElementById('topList');
            topList.innerHTML = '';
            
            if (data.players && data.players.length > 0) {
                data.players.forEach((player, index) => {
                    const playerEl = document.createElement('div');
                    playerEl.className = 'card';
                    playerEl.innerHTML = \`
                        <div style="display: flex; justify-content: space-between;">
                            <div>
                                <strong>\${index + 1}. \${player.first_name}</strong>
                                \${player.username ? '@' + slave.username : ''}
                            </div>
                            <div>\${player.balance} монет</div>
                        </div>
                    \`;
                    topList.appendChild(playerEl);
                });
            }
        }
        
        // Дать случайное задание
        async function giveRandomTask() {
            // Берем первого раба
            const response = await fetch(API_URL + '/slaves/' + currentUser.id);
            const data = await response.json();
            
            if (data.slaves && data.slaves.length > 0) {
                const slave = data.slaves[0];
                
                const taskResponse = await fetch(API_URL + '/tasks', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        master_id: currentUser.id,
                        user_id: slave.id,
                        title: 'Случайное задание',
                        description: 'Выполни что скажут'
                    })
                });
                
                const result = await taskResponse.json();
                if (result.success) {
                    alert('Задание дано!');
                }
            } else {
                alert('У вас нет рабов');
            }
        }
        
        // Модальное окно задания
        function openTaskModal(taskId, title, description) {
            currentTask = taskId;
            document.getElementById('modalTitle').textContent = title;
            document.getElementById('modalDesc').textContent = description;
            document.getElementById('modal').style.display = 'flex';
        }
        
        function closeModal() {
            document.getElementById('modal').style.display = 'none';
            document.getElementById('proofInput').value = '';
        }
        
        // Отправить выполнение
        async function submitTask() {
            const proof = document.getElementById('proofInput').value;
            
            if (!proof) {
                alert('Введите доказательство');
                return;
            }
            
            const response = await fetch(API_URL + '/tasks/' + currentTask + '/complete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ proof })
            });
            
            const result = await response.json();
            if (result.success) {
                alert('Задание отправлено на проверку!');
                closeModal();
                loadTasks();
            }
        }
        
        // Переключение вкладок
        function showTab(tabName) {
            // Скрыть все вкладки
            document.querySelectorAll('.tab').forEach(tab => {
                tab.classList.remove('active');
            });
            
            // Убрать активные кнопки
            document.querySelectorAll('.menu-btn').forEach(btn => {
                btn.classList.remove('active');
            });
            
            // Показать нужную вкладку
            document.getElementById(tabName).classList.add('active');
            
            // Активировать кнопку
            event.target.classList.add('active');
        }
        
        // Запуск при загрузке
        init();
    </script>
</body>
</html>
  `);
});

// ===== ЗАПУСК СЕРВЕРА =====
app.listen(PORT, () => {
  console.log(`🚀 Сервер запущен на http://localhost:${PORT}`);
  console.log(`🤖 Бот запущен`);
  console.log(`📱 Открой в Telegram: https://t.me/your_bot_username`);
});
