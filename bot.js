// ═══════════════════════════════════════════════════
// TECHNA TELEGRAM BOT
// Запуск: node bot.js
// Требования: npm install node-telegram-bot-api @supabase/supabase-js node-cron
// ═══════════════════════════════════════════════════

const TelegramBot = require('node-telegram-bot-api');
const { createClient } = require('@supabase/supabase-js');
const cron = require('node-cron');

// ── КОНФИГУРАЦИЯ ──────────────────────────────────
const TOKEN = '8620292158:AAEh4IrRrA6_M7mnkDbZLvArk8RlFs-D-MI';
const SUPA_URL = 'https://hfxkoxcwappfblionxum.supabase.co';
const SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhmeGtveGN3YXBwZmJsaW9ueHVtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc3ODQ5NjMsImV4cCI6MjA5MzM2MDk2M30.UwrG-LdwOPfnY_FzfdHUqiAwTQ2XQl9afEV8pWjnymc';

// Разрешённые пользователи — добавьте chat_id членов команды
const ALLOWED_USERS = [
  5307832046, // Ко-фаундер (вы)
  // 123456789, // Сейлз менеджер — добавьте их chat_id
  // 987654321, // Аккаунт менеджер
];

const CURRENT_MONTH = 'may26';

// ── ИНИЦИАЛИЗАЦИЯ ─────────────────────────────────
const bot = new TelegramBot(TOKEN, { polling: true });
const sb = createClient(SUPA_URL, SUPA_KEY);

console.log('🤖 Techna Bot запущен');

// ── ПРОВЕРКА ДОСТУПА ──────────────────────────────
function isAllowed(chatId) {
  return ALLOWED_USERS.includes(chatId);
}

function deny(chatId) {
  bot.sendMessage(chatId, '🚫 Доступ запрещён. Обратитесь к администратору.');
}

// ── ВСПОМОГАТЕЛЬНЫЕ ───────────────────────────────
async function getMonth() {
  const { data } = await sb.from('months').select('*').eq('id', CURRENT_MONTH).single();
  return data;
}

async function getTasks(stage = null) {
  let query = sb.from('tasks').select('*');
  if (stage) query = query.eq('stage', stage);
  const { data } = await query.order('priority', { ascending: false });
  return data || [];
}

async function getClients() {
  const { data } = await sb.from('clients').select('*').eq('month_id', CURRENT_MONTH);
  return data || [];
}

async function getMeetings() {
  const { data } = await sb.from('meetings').select('*').eq('done', false).order('meeting_date');
  return data || [];
}

async function getPipeline() {
  const { data } = await sb.from('pipeline').select('*');
  return data || [];
}

async function getToday() {
  const today = new Date().getDate();
  const { data } = await sb.from('daily_logs').select('*')
    .eq('month_id', CURRENT_MONTH).eq('day', today).single();
  return data;
}

function priorityEmoji(p) {
  return p === 'high' ? '🔴' : p === 'med' ? '🟡' : '🟢';
}

function stageEmoji(s) {
  const map = { contact:'📞', demo:'🎯', proposal:'📄', negotiation:'🤝', won:'✅' };
  return map[s] || '📋';
}

// ── КОМАНДЫ ───────────────────────────────────────

// /start
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  if (!isAllowed(chatId)) return deny(chatId);

  bot.sendMessage(chatId, `
🚀 *Techna Command Center*

Привет! Я ваш рабочий бот. Вот что умею:

📊 *Данные*
/today — сводка на сегодня
/tasks — активные задачи
/clients — клиенты месяца
/pipeline — воронка сделок
/plan — план vs факт

✅ *Управление*
/addtask — добавить задачу
/done ID — закрыть задачу
/log — внести метрики дня
/addclient — добавить клиента

📅 *Встречи*
/meetings — ближайшие встречи

❓ /help — список команд
`, { parse_mode: 'Markdown' });
});

// /help
bot.onText(/\/help/, (msg) => {
  const chatId = msg.chat.id;
  if (!isAllowed(chatId)) return deny(chatId);

  bot.sendMessage(chatId, `
📖 *Все команды:*

/today — сводка дня
/tasks — все задачи
/clients — клиенты
/pipeline — воронка
/plan — план месяца
/meetings — встречи

📊 *KPI отчёт:*
/kpi — заполнить показатели за сегодня
/kpireport — сводный отчёт по KPI
/kpiplan — план на месяц
/setplan calls 150 — обновить план

✅ *Задачи:*
/addtask Название | Кто | приоритет
/done ID — закрыть задачу

📅 *Встречи:*
/addmeeting Название | дата | контакт | ответственный
/donemeet ID — встреча проведена

📈 *Метрики дня:*
/log лиды звонки встречи демо оплата

🏢 *Клиенты:*
/addclient Название | сумма | менеджер
`, { parse_mode: 'Markdown' });
});

// /today — сводка дня
bot.onText(/\/today/, async (msg) => {
  const chatId = msg.chat.id;
  if (!isAllowed(chatId)) return deny(chatId);

  try {
    const [month, todayLog, tasks, meetings] = await Promise.all([
      getMonth(), getToday(),
      getTasks('todo'), getMeetings()
    ]);

    const pct = month ? Math.round((month.fact / month.plan) * 100) : 0;
    const today = new Date().getDate();
    const dLeft = Math.max(1, (month?.days || 22) - (today - 1));
    const remain = Math.max(0, (month?.plan || 200) - (month?.fact || 0));
    const perDay = (remain / dLeft).toFixed(1);

    const norms = month?.norms || { leads: 4, calls: 15, meet: 2, demo: 1, pay: 1 };
    const l = todayLog;

    const todayMeetings = meetings.filter(m => {
      if (!m.meeting_date) return false;
      const d = new Date(m.meeting_date);
      const now = new Date();
      return d.toDateString() === now.toDateString();
    });

    const topTasks = tasks.slice(0, 5);

    let text = `📅 *Сводка на ${new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}*\n\n`;

    text += `💰 *План: ${month?.plan || 200} млн | Факт: ${month?.fact || 0} млн | ${pct}%*\n`;
    text += `📉 Нужно ${perDay} млн/день (осталось ${dLeft} дней)\n\n`;

    if (l) {
      text += `📊 *Метрики сегодня:*\n`;
      text += `${l.leads >= norms.leads ? '✅' : '❌'} Лиды: ${l.leads}/${norms.leads}\n`;
      text += `${l.calls >= norms.calls ? '✅' : '❌'} Звонки: ${l.calls}/${norms.calls}\n`;
      text += `${l.meet >= norms.meet ? '✅' : '❌'} Встречи: ${l.meet}/${norms.meet}\n`;
      text += `${l.demo >= norms.demo ? '✅' : '❌'} Демо: ${l.demo}/${norms.demo}\n`;
      text += `${l.pay > 0 ? '💚' : '⚪'} Оплаты: ${l.pay} млн\n\n`;
    } else {
      text += `⚠️ *Метрики за сегодня ещё не внесены*\nИспользуйте: /log 4 15 2 1 0\n\n`;
    }

    if (todayMeetings.length) {
      text += `📅 *Встречи сегодня:*\n`;
      todayMeetings.forEach(m => {
        const time = new Date(m.meeting_date).toLocaleTimeString('ru-RU', { timeZone: 'Asia/Tashkent', hour: '2-digit', minute: '2-digit' });
        text += `🕐 ${time} — ${m.title} (${m.contact || '—'})\n`;
      });
      text += '\n';
    }

    if (topTasks.length) {
      text += `✅ *Задачи к выполнению:*\n`;
      topTasks.forEach(t => {
        text += `${priorityEmoji(t.priority)} [${t.id}] ${t.title}`;
        if (t.person) text += ` @${t.person}`;
        text += '\n';
      });
    }

    bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
  } catch (e) {
    bot.sendMessage(chatId, '❌ Ошибка загрузки данных: ' + e.message);
  }
});

// /plan — план месяца
bot.onText(/\/plan/, async (msg) => {
  const chatId = msg.chat.id;
  if (!isAllowed(chatId)) return deny(chatId);

  const month = await getMonth();
  if (!month) return bot.sendMessage(chatId, '❌ Данные не найдены');

  const pct = Math.round((month.fact / month.plan) * 100);
  const today = new Date().getDate();
  const dLeft = Math.max(1, month.days - (today - 1));
  const remain = Math.max(0, month.plan - month.fact);
  const perDay = (remain / dLeft).toFixed(1);

  const bar = '█'.repeat(Math.round(pct / 10)) + '░'.repeat(10 - Math.round(pct / 10));

  bot.sendMessage(chatId, `
📊 *${month.name}*

${bar} ${pct}%

💵 Факт: *${month.fact} млн*
🎯 План: *${month.plan} млн*
📉 Осталось: *${remain} млн*

⏱ Дней осталось: ${dLeft}
🔥 Нужно в день: *${perDay} млн*

${pct >= 100 ? '✅ ПЛАН ВЫПОЛНЕН!' : pct >= 70 ? '⚡ Хороший темп!' : '🚨 Нужно ускориться!'}
`, { parse_mode: 'Markdown' });
});

// /addmeeting — добавить встречу
// Формат: /addmeeting Название | дата время | контакт | ответственный
// Пример: /addmeeting Демо Uzum | 2026-05-10 14:00 | Хасан | КФ
bot.onText(/\/addmeeting (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  if (!isAllowed(chatId)) return deny(chatId);

  const parts = match[1].split('|').map(s => s.trim());
  const title = parts[0];
  const dateStr = parts[1] || null;
  const contact = parts[2] || '';
  const person = parts[3] || 'КФ';

  if (!title) {
    return bot.sendMessage(chatId, `❌ Укажите название встречи\n\nФормат:\n/addmeeting Название | дата время | контакт | ответственный\n\nПример:\n/addmeeting Демо Uzum | 2026-05-10 14:00 | Хасан | КФ`);
  }

  let meetingDate = null;
  if (dateStr) {
    try {
      let d;
      if (dateStr.includes('-')) {
        // Формат: 2026-05-10 14:00 — считаем как UTC+5
        d = new Date(dateStr.trim().replace(' ', 'T') + ':00.000+05:00');
      } else if (dateStr.includes('.')) {
        // Формат: 10.05 14:00 или 10.05.2026 14:00
        const parts2 = dateStr.trim().split(' ');
        const datePart = parts2[0];
        const timePart = parts2[1] || '10:00';
        const dateParts = datePart.split('.');
        const day = dateParts[0].padStart(2,'0');
        const month = dateParts[1].padStart(2,'0');
        const year = dateParts[2] || new Date().getFullYear();
        d = new Date(`${year}-${month}-${day}T${timePart}:00.000+05:00`);
      } else {
        d = new Date(dateStr.trim() + '+05:00');
      }
      if (!isNaN(d.getTime())) meetingDate = d.toISOString();
    } catch(e) {
      // Если дата не парсится — сохраняем без даты
    }
  }

  const { data, error } = await sb.from('meetings').insert({
    title,
    meeting_date: meetingDate,
    contact,
    person,
    done: false,
    note: ''
  }).select().single();

  if (error) {
    bot.sendMessage(chatId, '❌ Ошибка: ' + error.message);
  } else {
    const dateDisplay = meetingDate
      ? new Date(meetingDate).toLocaleDateString('ru-RU', { timeZone: 'Asia/Tashkent', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })
      : 'дата не указана';

    bot.sendMessage(chatId, `
✅ *Встреча добавлена!*

📍 *${title}*
🕐 ${dateDisplay}
👤 ${contact || '—'}
👨‍💼 Ответственный: ${person}

_Напоминание придёт за 1 час до встречи_
`, { parse_mode: 'Markdown' });
  }
});

// /donemeet ID — закрыть встречу
bot.onText(/\/donemeet (\d+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  if (!isAllowed(chatId)) return deny(chatId);

  const id = parseInt(match[1]);
  const { data, error } = await sb.from('meetings').update({ done: true }).eq('id', id).select().single();

  if (error || !data) {
    bot.sendMessage(chatId, `❌ Встреча #${id} не найдена`);
  } else {
    bot.sendMessage(chatId, `✅ Встреча отмечена как проведённая:\n*${data.title}*`, { parse_mode: 'Markdown' });
  }
});
bot.onText(/\/tasks$/, async (msg) => {
  const chatId = msg.chat.id;
  if (!isAllowed(chatId)) return deny(chatId);

  const [todo, inprogress, review] = await Promise.all([
    getTasks('todo'), getTasks('inprogress'), getTasks('review')
  ]);

  let text = `✅ *Задачи*\n\n`;

  if (todo.length) {
    text += `🔴 *К выполнению (${todo.length}):*\n`;
    todo.forEach(t => text += `${priorityEmoji(t.priority)} [${t.id}] ${t.title} ${t.person ? '@' + t.person : ''}\n`);
    text += '\n';
  }

  if (inprogress.length) {
    text += `🟡 *В работе (${inprogress.length}):*\n`;
    inprogress.forEach(t => text += `${priorityEmoji(t.priority)} [${t.id}] ${t.title} ${t.person ? '@' + t.person : ''}\n`);
    text += '\n';
  }

  if (review.length) {
    text += `🟣 *На проверке (${review.length}):*\n`;
    review.forEach(t => text += `[${t.id}] ${t.title} ${t.person ? '@' + t.person : ''}\n`);
  }

  if (!todo.length && !inprogress.length && !review.length) {
    text += '🎉 Все задачи выполнены!';
  }

  text += '\n\n_/done ID — закрыть задачу_';

  bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
});

// /done ID — закрыть задачу
bot.onText(/\/done (\d+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  if (!isAllowed(chatId)) return deny(chatId);

  const id = parseInt(match[1]);
  const { data, error } = await sb.from('tasks').update({ stage: 'done' }).eq('id', id).select().single();

  if (error || !data) {
    bot.sendMessage(chatId, `❌ Задача #${id} не найдена`);
  } else {
    bot.sendMessage(chatId, `✅ Задача закрыта:\n*${data.title}*`, { parse_mode: 'Markdown' });
  }
});

// /addtask — добавить задачу
bot.onText(/\/addtask (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  if (!isAllowed(chatId)) return deny(chatId);

  const parts = match[1].split('|').map(s => s.trim());
  const title = parts[0];
  const person = parts[1] || null;
  const priority = parts[2] || 'med';

  if (!title) return bot.sendMessage(chatId, '❌ Укажите название задачи');

  const { data, error } = await sb.from('tasks').insert({
    title, person, priority, stage: 'todo'
  }).select().single();

  if (error) {
    bot.sendMessage(chatId, '❌ Ошибка: ' + error.message);
  } else {
    bot.sendMessage(chatId, `✅ *Задача добавлена [#${data.id}]:*\n${title}\n👤 ${person || '—'} | ${priorityEmoji(priority)} ${priority}`, { parse_mode: 'Markdown' });
  }
});

// /log — внести метрики
bot.onText(/\/log (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  if (!isAllowed(chatId)) return deny(chatId);

  const nums = match[1].trim().split(/\s+/).map(Number);
  if (nums.length < 5 || nums.some(isNaN)) {
    return bot.sendMessage(chatId, '❌ Формат: /log лиды звонки встречи демо оплата\nПример: /log 4 15 2 1 10');
  }

  const [leads, calls, meet, demo, pay] = nums;
  const today = new Date().getDate();

  // Upsert — обновить если уже есть за этот день
  const { data: existing } = await sb.from('daily_logs')
    .select('id').eq('month_id', CURRENT_MONTH).eq('day', today).single();

  if (existing) {
    await sb.from('daily_logs').update({ leads, calls, meet, demo, pay }).eq('id', existing.id);
  } else {
    await sb.from('daily_logs').insert({ month_id: CURRENT_MONTH, day: today, leads, calls, meet, demo, pay });
  }

  // Обновить факт в месяце
  const { data: logs } = await sb.from('daily_logs').select('pay').eq('month_id', CURRENT_MONTH);
  const totalFact = logs ? logs.reduce((s, l) => s + l.pay, 0) : 0;
  await sb.from('months').update({ fact: Math.round(totalFact * 10) / 10 }).eq('id', CURRENT_MONTH);

  const month = await getMonth();
  const pct = month ? Math.round((month.fact / month.plan) * 100) : 0;
  const norms = month?.norms || { leads: 4, calls: 15, meet: 2, demo: 1, pay: 1 };

  bot.sendMessage(chatId, `
📊 *Метрики за день ${today} внесены:*

${leads >= norms.leads ? '✅' : '❌'} Лиды: ${leads}/${norms.leads}
${calls >= norms.calls ? '✅' : '❌'} Звонки: ${calls}/${norms.calls}
${meet >= norms.meet ? '✅' : '❌'} Встречи: ${meet}/${norms.meet}
${demo >= norms.demo ? '✅' : '❌'} Демо: ${demo}/${norms.demo}
${pay > 0 ? '💚' : '⚪'} Оплата: ${pay} млн

💰 Факт месяца: *${month?.fact || 0} млн* (${pct}%)
`, { parse_mode: 'Markdown' });
});

// /clients — клиенты
bot.onText(/\/clients/, async (msg) => {
  const chatId = msg.chat.id;
  if (!isAllowed(chatId)) return deny(chatId);

  const clients = await getClients();
  if (!clients.length) return bot.sendMessage(chatId, '📭 Клиентов нет');

  const total = Math.round(clients.reduce((s, c) => s + (c.amount || 0), 0) * 10) / 10;
  const statusEmoji = { new: '🆕', retain: '🔄', prepaid: '💛', risk: '🔴', upsell: '📈' };

  let text = `🏢 *Клиенты — ${month_name()} (${clients.length})*\n\n`;
  clients.forEach(c => {
    text += `${statusEmoji[c.status] || '▫️'} *${c.name}* — ${c.amount} млн`;
    if (c.manager) text += ` @${c.manager}`;
    text += '\n';
    if (c.next_step) text += `   → ${c.next_step}\n`;
  });
  text += `\n💰 *Итого: ${total} млн*`;

  bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
});

// /addclient — добавить клиента
bot.onText(/\/addclient (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  if (!isAllowed(chatId)) return deny(chatId);

  const parts = match[1].split('|').map(s => s.trim());
  const name = parts[0];
  const amount = parseFloat(parts[1]) || 0;
  const manager = parts[2] || '';

  if (!name) return bot.sendMessage(chatId, '❌ Укажите название\nФормат: /addclient Название | сумма | менеджер');

  const { data, error } = await sb.from('clients').insert({
    month_id: CURRENT_MONTH, name, amount, manager, status: 'new', next_step: ''
  }).select().single();

  if (error) {
    bot.sendMessage(chatId, '❌ Ошибка: ' + error.message);
  } else {
    bot.sendMessage(chatId, `✅ *Клиент добавлен:*\n🏢 ${name}\n💰 ${amount} млн\n👤 ${manager || '—'}`, { parse_mode: 'Markdown' });
  }
});

// /pipeline — воронка
bot.onText(/\/pipeline/, async (msg) => {
  const chatId = msg.chat.id;
  if (!isAllowed(chatId)) return deny(chatId);

  const deals = await getPipeline();
  if (!deals.length) return bot.sendMessage(chatId, '📭 Сделок нет');

  const total = Math.round(deals.reduce((s, d) => s + (d.amount || 0), 0) * 10) / 10;
  const won = Math.round(deals.filter(d => d.stage === 'won').reduce((s, d) => s + d.amount, 0) * 10) / 10;

  let text = `🔀 *Pipeline (${deals.length} сделок)*\n\n`;

  const stages = ['contact', 'demo', 'proposal', 'negotiation', 'won'];
  stages.forEach(stage => {
    const stageDeal = deals.filter(d => d.stage === stage);
    if (!stageDeal.length) return;
    const stageTotal = Math.round(stageDeal.reduce((s, d) => s + d.amount, 0) * 10) / 10;
    text += `${stageEmoji(stage)} *${stageLabel(stage)} — ${stageTotal} млн*\n`;
    stageDeal.forEach(d => text += `  [${d.id}] ${d.title} — ${d.amount} млн\n`);
    text += '\n';
  });

  text += `💰 *Воронка: ${total} млн | Закрыто: ${won} млн*`;

  bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
});

// /meetings — встречи
bot.onText(/\/meetings/, async (msg) => {
  const chatId = msg.chat.id;
  if (!isAllowed(chatId)) return deny(chatId);

  const meetings = await getMeetings();
  if (!meetings.length) return bot.sendMessage(chatId, '📭 Встреч нет');

  let text = `📅 *Предстоящие встречи:*\n\n`;
  meetings.forEach(m => {
    const dt = m.meeting_date ? new Date(m.meeting_date) : null;
    const dateStr2 = dt ? dt.toLocaleDateString('ru-RU', { timeZone: 'Asia/Tashkent', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
    text += `📍 *${m.title}*\n`;
    text += `🕐 ${dateStr2}\n`;
    if (m.contact) text += `👤 ${m.contact}\n`;
    if (m.person) text += `👨‍💼 ${m.person}\n`;
    text += '\n';
  });

  bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
});

// ── ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ───────────────────────
function month_name() { return 'Май 2026'; }

function stageLabel(s) {
  const map = { contact: 'Контакт', demo: 'Демо', proposal: 'Предложение', negotiation: 'Переговоры', won: 'Закрыто' };
  return map[s] || s;
}

// ── KPI ДИАЛОГ ────────────────────────────────────
// Состояние диалога для каждого пользователя
const kpiSessions = {};

const KPI_METRICS = [
  { key: 'calls',        label: 'Количество звонков',    emoji: '📞' },
  { key: 'leads_meta',   label: 'Лиды Meta',             emoji: '📘' },
  { key: 'leads_google', label: 'Лиды Google',           emoji: '🔍' },
  { key: 'organic',      label: 'Органический трафик',   emoji: '🌱' },
  { key: 'qualified',    label: 'Квалификация',           emoji: '✅' },
  { key: 'demo',         label: 'Демо',                  emoji: '🎯' },
  { key: 'deals',        label: 'Сделки',                emoji: '🤝' },
  { key: 'avg_check',    label: 'Средний чек (сум)',     emoji: '💰' },
  { key: 'conversion',   label: 'Конверсия (%)',         emoji: '📊' },
  { key: 'revenue',      label: 'Выручка (сум)',         emoji: '💵' },
];

// Запустить диалог заполнения KPI
async function startKpiDialog(chatId, person) {
  const plans = await getKpiPlans();
  kpiSessions[chatId] = {
    step: 0,
    data: {},
    person: person,
    plans: plans
  };
  await sendKpiQuestion(chatId);
}

async function sendKpiQuestion(chatId) {
  const session = kpiSessions[chatId];
  if (!session) return;

  const metric = KPI_METRICS[session.step];
  if (!metric) {
    await saveKpiData(chatId);
    return;
  }

  const plan = session.plans[metric.key] || 0;
  const planText = plan > 0 ? `\n📋 План на месяц: *${formatNum(plan)}*` : '';

  await bot.sendMessage(chatId, `
${metric.emoji} *${metric.label}*${planText}

Введите факт за сегодня (или 0 если нет данных):
_Шаг ${session.step + 1} из ${KPI_METRICS.length}_
`, {
    parse_mode: 'Markdown',
    reply_markup: {
      keyboard: [['0'], ['Пропустить'], ['❌ Отмена']],
      resize_keyboard: true,
      one_time_keyboard: true
    }
  });
}

async function saveKpiData(chatId) {
  const session = kpiSessions[chatId];
  if (!session) return;

  const day = new Date().getDate();
  const person = session.person;

  // Сохраняем все метрики
  for (const [metric, value] of Object.entries(session.data)) {
    await sb.from('kpi_logs').upsert({
      month_id: CURRENT_MONTH,
      day,
      metric,
      value: parseFloat(value) || 0,
      person
    }, { onConflict: 'month_id,day,metric,person' });
  }

  // Считаем итоги
  const plans = session.plans;
  let summary = `✅ *Отчёт за ${day} мая сохранён!*\n\n`;
  summary += `👤 Сотрудник: ${person}\n\n`;

  for (const metric of KPI_METRICS) {
    const val = session.data[metric.key];
    if (val === undefined) continue;
    const plan = plans[metric.key] || 0;
    const fact = parseFloat(val) || 0;
    const pct = plan > 0 ? Math.round((fact / plan) * 100) : 0;
    const icon = pct >= 100 ? '✅' : pct >= 70 ? '🟡' : '🔴';
    summary += `${icon} ${metric.emoji} ${metric.label}: *${formatNum(fact)}* / ${formatNum(plan)} (${pct}%)\n`;
  }

  delete kpiSessions[chatId];

  await bot.sendMessage(chatId, summary, {
    parse_mode: 'Markdown',
    reply_markup: { remove_keyboard: true }
  });

  // Уведомить кофаундера если заполнял другой сотрудник
  if (chatId !== 5307832046) {
    try {
      await bot.sendMessage(5307832046, `📊 *${person} заполнил отчёт за ${day} мая*\n\n${summary}`, { parse_mode: 'Markdown' });
    } catch(e) {}
  }
}

async function getKpiPlans() {
  const { data } = await sb.from('kpi_plans').select('*').eq('month_id', CURRENT_MONTH);
  const result = {};
  (data || []).forEach(p => result[p.metric] = p.plan_value);
  return result;
}

function formatNum(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + ' млн';
  if (n >= 1000) return (n / 1000).toFixed(0) + 'к';
  return n.toString();
}

// /kpi — начать заполнение KPI
bot.onText(/\/kpi/, async (msg) => {
  const chatId = msg.chat.id;
  if (!isAllowed(chatId)) return deny(chatId);

  // Найти имя сотрудника по chat_id
  const personMap = {
    5307832046: 'КФ',
    // добавьте: 123456789: 'СМ',
  };
  const person = personMap[chatId] || 'Команда';

  await bot.sendMessage(chatId, `
📊 *Заполнение KPI за сегодня*

Отвечайте на каждый вопрос числом.
Нажмите "0" если показатель равен нулю.
Нажмите "Пропустить" чтобы не заполнять показатель.

Начинаем!
`, { parse_mode: 'Markdown' });

  await startKpiDialog(chatId, person);
});

// /kpiplan — посмотреть/обновить план на месяц
bot.onText(/\/kpiplan/, async (msg) => {
  const chatId = msg.chat.id;
  if (!isAllowed(chatId)) return deny(chatId);

  const plans = await getKpiPlans();
  let text = `📋 *План KPI на ${CURRENT_MONTH === 'may26' ? 'Май 2026' : CURRENT_MONTH}:*\n\n`;

  KPI_METRICS.forEach((m, i) => {
    text += `${i + 1}. ${m.emoji} ${m.label}: *${formatNum(plans[m.key] || 0)}*\n`;
  });

  text += '\n_Чтобы обновить план: /setplan метрика значение_';
  text += '\n_Пример: /setplan calls 150_';

  bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
});

// /setplan — обновить план
bot.onText(/\/setplan (\w+) ([\d.]+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  if (!isAllowed(chatId)) return deny(chatId);

  const metric = match[1];
  const value = parseFloat(match[2]);

  const validMetrics = KPI_METRICS.map(m => m.key);
  if (!validMetrics.includes(metric)) {
    return bot.sendMessage(chatId, `❌ Неизвестный показатель: ${metric}\n\nДоступные: ${validMetrics.join(', ')}`);
  }

  await sb.from('kpi_plans').upsert({
    month_id: CURRENT_MONTH,
    metric,
    plan_value: value
  }, { onConflict: 'month_id,metric' });

  const m = KPI_METRICS.find(x => x.key === metric);
  bot.sendMessage(chatId, `✅ План обновлён!\n${m.emoji} ${m.label}: *${formatNum(value)}*`, { parse_mode: 'Markdown' });
});

// /kpireport — отчёт по KPI за месяц
bot.onText(/\/kpireport/, async (msg) => {
  const chatId = msg.chat.id;
  if (!isAllowed(chatId)) return deny(chatId);

  const [plans, logs] = await Promise.all([
    getKpiPlans(),
    sb.from('kpi_logs').select('*').eq('month_id', CURRENT_MONTH).then(r => r.data || [])
  ]);

  // Суммируем факт по каждой метрике
  const facts = {};
  logs.forEach(l => {
    if (!facts[l.metric]) facts[l.metric] = 0;
    facts[l.metric] += l.value;
  });

  const today = new Date().getDate();
  let text = `📊 *KPI отчёт — ${today} мая*\n\n`;
  text += `${'Показатель'.padEnd(20)} | План | Факт | %\n`;
  text += '─'.repeat(40) + '\n';

  let allGood = true;
  for (const metric of KPI_METRICS) {
    const plan = plans[metric.key] || 0;
    const fact = facts[metric.key] || 0;
    const pct = plan > 0 ? Math.round((fact / plan) * 100) : 0;
    const icon = pct >= 100 ? '✅' : pct >= 70 ? '🟡' : '🔴';
    if (pct < 70) allGood = false;
    text += `${icon} ${metric.emoji} *${metric.label}*\n`;
    text += `   ${formatNum(fact)} / ${formatNum(plan)} = ${pct}%\n`;
  }

  text += `\n${allGood ? '🎉 Все показатели в норме!' : '⚠️ Есть отставания — нужно ускориться!'}`;

  bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
});

// Обработка ответов в диалоге KPI
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  if (!isAllowed(chatId)) return;
  if (!kpiSessions[chatId]) return;
  if (msg.text && msg.text.startsWith('/')) return;

  const session = kpiSessions[chatId];
  const text = msg.text || '';

  if (text === '❌ Отмена') {
    delete kpiSessions[chatId];
    await bot.sendMessage(chatId, '❌ Заполнение отменено', { reply_markup: { remove_keyboard: true } });
    return;
  }

  const metric = KPI_METRICS[session.step];

  if (text !== 'Пропустить') {
    const value = parseFloat(text.replace(',', '.'));
    if (!isNaN(value)) {
      session.data[metric.key] = value;
    } else {
      await bot.sendMessage(chatId, '❌ Введите число. Попробуйте ещё раз:');
      return;
    }
  }

  session.step++;

  if (session.step >= KPI_METRICS.length) {
    await saveKpiData(chatId);
  } else {
    await sendKpiQuestion(chatId);
  }
});

// ── CRON: Запрос отчёта в 17:00 ──────────────────
// Каждый день в 17:00 (UTC+5 = 12:00 UTC)
cron.schedule('0 12 * * 1-6', async () => {
  console.log('📋 Запрос KPI отчёта...');
  for (const userId of ALLOWED_USERS) {
    try {
      await bot.sendMessage(userId, `
📊 *Время заполнить KPI за сегодня!*

Нажмите /kpi чтобы начать заполнение.
Займёт 2-3 минуты.

_Данные сразу появятся на дашборде_
`, { parse_mode: 'Markdown' });
    } catch (e) {
      console.error('Ошибка запроса KPI для', userId, e.message);
    }
  }
});



// Утренняя сводка каждый день в 9:00 (UTC+5 = 4:00 UTC)
cron.schedule('0 4 * * 1-5', async () => {
  console.log('📊 Отправка утренней сводки...');
  for (const userId of ALLOWED_USERS) {
    try {
      const [month, tasks, meetings] = await Promise.all([
        getMonth(), getTasks('todo'), getMeetings()
      ]);

      const pct = month ? Math.round((month.fact / month.plan) * 100) : 0;
      const today = new Date().getDate();
      const dLeft = Math.max(1, (month?.days || 22) - (today - 1));
      const remain = Math.max(0, (month?.plan || 200) - (month?.fact || 0));
      const perDay = (remain / dLeft).toFixed(1);

      const todayMeetings = meetings.filter(m => {
        if (!m.meeting_date) return false;
        return new Date(m.meeting_date).toDateString() === new Date().toDateString();
      });

      let text = `☀️ *Доброе утро! Сводка на ${new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}*\n\n`;
      text += `💰 Факт: ${month?.fact || 0} / ${month?.plan || 200} млн (${pct}%)\n`;
      text += `🎯 Нужно сегодня: *${perDay} млн*\n\n`;

      if (todayMeetings.length) {
        text += `📅 *Встречи сегодня:*\n`;
        todayMeetings.forEach(m => {
          const time = new Date(m.meeting_date).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
          text += `🕐 ${time} — ${m.title}\n`;
        });
        text += '\n';
      }

      const highTasks = tasks.filter(t => t.priority === 'high').slice(0, 3);
      if (highTasks.length) {
        text += `🔴 *Приоритетные задачи:*\n`;
        highTasks.forEach(t => text += `• [${t.id}] ${t.title} ${t.person ? '@' + t.person : ''}\n`);
      }

      text += '\n_/today для полной сводки_';

      await bot.sendMessage(userId, text, { parse_mode: 'Markdown' });
    } catch (e) {
      console.error('Ошибка утренней сводки для', userId, e.message);
    }
  }
});

// Вечерний итог каждый день в 18:00 (UTC+5 = 13:00 UTC)
cron.schedule('0 13 * * 1-5', async () => {
  console.log('🌙 Отправка вечернего итога...');
  for (const userId of ALLOWED_USERS) {
    try {
      const [month, todayLog] = await Promise.all([getMonth(), getToday()]);
      const norms = month?.norms || { leads: 4, calls: 15, meet: 2, demo: 1, pay: 1 };
      const pct = month ? Math.round((month.fact / month.plan) * 100) : 0;

      let text = `🌙 *Итоги дня ${new Date().getDate()} мая*\n\n`;

      if (todayLog) {
        const l = todayLog;
        const allOk = l.leads >= norms.leads && l.calls >= norms.calls && l.meet >= norms.meet;
        text += `${allOk ? '✅' : '⚠️'} *Метрики:*\n`;
        text += `${l.leads >= norms.leads ? '✅' : '❌'} Лиды: ${l.leads}/${norms.leads}\n`;
        text += `${l.calls >= norms.calls ? '✅' : '❌'} Звонки: ${l.calls}/${norms.calls}\n`;
        text += `${l.meet >= norms.meet ? '✅' : '❌'} Встречи: ${l.meet}/${norms.meet}\n`;
        text += `${l.pay > 0 ? '💚' : '⚪'} Оплата: ${l.pay} млн\n\n`;
      } else {
        text += `⚠️ *Метрики не внесены!*\nИспользуйте: /log лиды звонки встречи демо оплата\n\n`;
      }

      text += `💰 Факт месяца: *${month?.fact || 0} млн* (${pct}%)\n`;
      text += pct >= 100 ? '🎉 План выполнен!' : `📉 До плана: ${Math.max(0, (month?.plan || 200) - (month?.fact || 0))} млн`;

      await bot.sendMessage(userId, text, { parse_mode: 'Markdown' });
    } catch (e) {
      console.error('Ошибка вечернего итога для', userId, e.message);
    }
  }
});

// Напоминание о встречах за 1 час — каждые 15 минут проверяем
cron.schedule('*/15 * * * *', async () => {
  const meetings = await getMeetings();
  const now = new Date();
  const inOneHour = new Date(now.getTime() + 60 * 60 * 1000);

  for (const meeting of meetings) {
    if (!meeting.meeting_date) continue;
    const meetTime = new Date(meeting.meeting_date);

    // Если встреча через 45-75 минут — отправляем напоминание
    const diff = meetTime - now;
    if (diff > 45 * 60 * 1000 && diff < 75 * 60 * 1000) {
      const timeStr = meetTime.toLocaleTimeString('ru-RU', { timeZone: 'Asia/Tashkent', hour: '2-digit', minute: '2-digit' });
      for (const userId of ALLOWED_USERS) {
        try {
          await bot.sendMessage(userId, `
🔔 *Напоминание о встрече через 1 час!*

📍 *${meeting.title}*
🕐 ${timeStr}
👤 ${meeting.contact || '—'}
👨‍💼 Ответственный: ${meeting.person || '—'}
${meeting.note ? '\n📝 ' + meeting.note : ''}
`, { parse_mode: 'Markdown' });
        } catch (e) {
          console.error('Ошибка напоминания', e.message);
        }
      }
    }
  }
});

console.log('⏰ Cron задачи запущены:');
console.log('  📊 Утренняя сводка: 9:00 (пн-пт)');
console.log('  🌙 Вечерний итог: 18:00 (пн-пт)');
console.log('  🔔 Напоминания о встречах: каждые 15 мин');
