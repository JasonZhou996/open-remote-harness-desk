const OPEN = '<send_user_message_question_reply>';
const CLOSE = '</send_user_message_question_reply>';

export function asyncQuestions(item) {
  if (item.type !== 'agentMessage' || item.delivery !== 'async') return [];
  return item.questions?.length
    ? item.questions.map((q, index) => ({id: JSON.stringify(['request_user_input_async', item.id, index]), question: q.title, options: q.options || []}))
    : [{id: item.id, question: item.text || '', options: []}];
}

export function parseQuestionReply(content = []) {
  const text = content.filter(p => p.type === 'text').map(p => p.text).join('\n').trim();
  if (!text.startsWith(OPEN) || !text.endsWith(CLOSE)) return [];
  try {
    const parsed = JSON.parse(text.slice(OPEN.length, -CLOSE.length));
    const replies = Array.isArray(parsed) ? parsed : [parsed];
    return replies.every(r => r && ['questionItemId', 'question', 'answer'].every(k => typeof r[k] === 'string')) ? replies : [];
  } catch { return []; }
}

export function questionReply(questions, answers) {
  const replies = questions.filter(q => answers[q.id]?.length).map(q => ({questionItemId: q.id, question: q.question, answer: answers[q.id].join('\n')}));
  if (!replies.length) throw new Error("Choose or enter an answer");
  return `${OPEN}\n${JSON.stringify(replies)}\n${CLOSE}`;
}

export function validateUserInputResponse(questions, response) {
  const answers = response?.answers;
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) throw new Error("Invalid answer format");
  if (Object.keys(answers).some(id => !questions.some(q => q.id === id))) throw new Error("The questions have changed. Refresh and try again.");
  const result = Object.create(null);
  for (const q of questions) {
    const values = answers[q.id]?.answers;
    if (!Array.isArray(values) || !values.length || values.length > 20 || values.some(v => typeof v !== 'string' || !v.trim() || v.length > 20000)) throw new Error("Please answer every question");
    result[q.id] = {answers: values};
  }
  return {answers: result};
}

// One form for the native blocking question and the asynchronous question message.
export function createQuestionCard(questions, submit, {partial = false} = {}) {
  const form = document.createElement('form');
  form.className = 'user-input-card';
  const heading = document.createElement('strong'); heading.textContent = "Your input is needed"; form.append(heading);
  const rows = new Map();
  for (const q of questions) {
    const field = document.createElement('fieldset'); field.className = 'user-input-question'; field.dataset.questionId = q.id;
    const legend = document.createElement('legend'); legend.dataset.i18nIgnore = ''; legend.textContent = q.question; field.append(legend);
    for (const [index, option] of (q.options || []).entries()) {
      const value = typeof option === 'string' ? option : option.label;
      const label = document.createElement('label'); label.className = 'user-input-option';
      const input = document.createElement('input'); input.type = 'radio'; input.name = q.id; input.value = value; input.checked = index === 0;
      const copy = document.createElement('span'), title = document.createElement('strong'); copy.dataset.i18nIgnore = ''; title.textContent = value; copy.append(title);
      if (typeof option.description === 'string' && option.description) { const description = document.createElement('small'); description.textContent = option.description; copy.append(description); }
      label.append(input, copy); field.append(label);
    }
    const label = document.createElement('label'); label.className = 'user-input-custom'; label.textContent = q.options?.length ? "Add details or enter another answer" : "Your answer";
    const input = document.createElement('input'); input.type = q.isSecret ? 'password' : 'text'; input.maxLength = 20000; input.placeholder = q.options?.length ? "An entered answer overrides the selected option" : "Enter an answer";
    input.oninput = () => { if (input.value.trim()) for (const radio of field.querySelectorAll('input[type=radio]')) radio.checked = false; };
    field.addEventListener('change', event => { if (event.target.type === 'radio') input.value = ''; });
    label.append(input); field.append(label); form.append(field); rows.set(q.id, {field, input});
  }
  const error = document.createElement('p'); error.className = 'user-input-error'; error.setAttribute('role', 'alert'); error.hidden = true;
  const button = document.createElement('button'); button.type = 'submit'; button.className = 'user-input-submit'; button.textContent = "Submit answers"; form.append(error, button);
  form.applyAnswers = answers => {
    for (const [id, value] of Object.entries(answers)) {
      const row = rows.get(id); if (!row) continue;
      row.input.value = (Array.isArray(value) ? value : [value]).join('\n'); row.field.disabled = true;
      row.field.dataset.answered = 'true';
    }
    if ([...rows.values()].every(r => r.field.dataset.answered)) { button.disabled = true; button.textContent = "Submitted"; }
  };
  form.onsubmit = async event => {
    event.preventDefault(); if (button.disabled) return;
    const answers = Object.create(null);
    for (const [id, {field, input}] of rows) {
      if (field.dataset.answered) continue;
      const value = input.value.trim() || field.querySelector('input[type=radio]:checked')?.value;
      if (value) answers[id] = [value];
      else if (!partial) { error.textContent = "Please answer every question"; error.hidden = false; input.focus(); return; }
    }
    if (!Object.keys(answers).length) { error.textContent = "Choose or enter an answer"; error.hidden = false; return; }
    error.hidden = true; button.disabled = true; button.textContent = "Submitting…";
    for (const {field} of rows.values()) field.disabled = true;
    try { await submit(answers); form.applyAnswers(answers); }
    catch (e) { error.textContent = e.message || "Submission failed. Please try again."; error.hidden = false; }
    finally {
      const done = [...rows.values()].every(r => r.field.dataset.answered);
      for (const {field} of rows.values()) field.disabled = Boolean(field.dataset.answered);
      button.disabled = done; button.textContent = done ? "Submitted" : "Submit answers";
    }
  };
  return form;
}
