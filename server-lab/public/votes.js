(() => {
 'use strict';
 const create = (tag, text) => {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  return element;
 };
 const input = (form, title, type, maxLength) => {
  const label = create('label', title);
  const control = create('input');
  control.type = type;
  control.required = true;
  if (maxLength) control.maxLength = maxLength;
  label.append(control); form.append(label);
  return control;
 };
 async function request(url, method = 'GET', data) {
  const options = {method, credentials:'same-origin', cache:'no-store'};
  if (data !== undefined) {
   options.headers = {'Content-Type':'application/json'};
   options.body = JSON.stringify(data);
  }
  const response = await fetch(url, options);
  const result = await response.json();
  if (!response.ok) throw Error(result.error || 'Не удалось загрузить голосование');
  return result;
 }
 async function display(panel) {
  const {series, episode} = panel.dataset;
  const url = '/api/series/' + encodeURIComponent(series) + '/episodes/' + encodeURIComponent(episode) + '/poll';
  const data = await request(url);
  panel.replaceChildren();
  if (!data.poll && !data.owner) return;
  const status = create('p');
  status.setAttribute('role','status');
  async function mutate(path, method, body) {
   if (panel.dataset.busy === 'true') return;
   panel.dataset.busy = 'true';
   try {
    await request(url + path, method, body);
    await display(panel);
   } catch (error) {status.textContent = error.message;}
   finally {delete panel.dataset.busy;}
  }
  if (!data.poll) {
   const details = create('details');
   details.append(create('summary','Предложить зрителям выбор'));
   const form = create('form');
   const question = input(form,'Вопрос зрителям','text',180);
   const first = input(form,'Первый вариант','text',80);
   const second = input(form,'Второй вариант','text',80);
   const deadline = input(form,'Окончание по вашему времени','datetime-local');
   form.append(create('button','Открыть голосование'));
   form.onsubmit = event => {
    event.preventDefault();
    mutate('','POST',{question:question.value,options:[first.value,second.value],closesAt:new Date(deadline.value).getTime()});
   };
   details.append(form); panel.append(details,status);
   return;
  }
  const poll = data.poll;
  panel.append(create('h3',poll.question));
  panel.append(create('p', (poll.closed ? 'Голосование завершено' : 'Голосование до') + ' · ' + new Date(poll.closesAt).toLocaleString('ru')));
  poll.options.forEach((option,index) => {
   if (!data.canVote || poll.closed) {
    const tally = poll.counts ? ' · ' + poll.counts[index] : '';
    panel.append(create('p', option + tally));
    return;
   }
   const button = create('button',option);
   button.type = 'button';
   button.setAttribute('aria-pressed',String(index === poll.mine));
   button.onclick = () => mutate('/vote','POST',{choice:index});
   panel.append(button);
  });
  if (poll.mine !== null && data.canVote && !poll.closed) {
   const undo = create('button','Отозвать голос'); undo.type = 'button';
   undo.onclick = () => mutate('/vote','DELETE',{}); panel.append(undo);
  }
  if (!data.owner && !data.canVote && !poll.closed) panel.append(create('p','Войдите в MARCOSA, чтобы проголосовать.'));
  if (poll.result) {
   panel.append(create('p',poll.result.note));
   if (poll.result.href) {
    const link = create('a','Перейти к продолжению');
    link.href = poll.result.href; panel.append(link);
   }
  } else if (poll.closed && data.owner && data.continuations.length) {
   const form = create('form');
   const label = create('label','Эпизод с продолжением');
   const select = create('select');
   for (const item of data.continuations) {
    const option = create('option',item.title); option.value = String(item.id); select.append(option);
   }
   label.append(select); form.append(label);
   const note = input(form,'Как выбор повлиял на продолжение','text',400);
   form.append(create('button','Опубликовать итог'));
   form.onsubmit = event => {event.preventDefault();mutate('/result','POST',{episodeId:Number(select.value),note:note.value});};
   panel.append(form);
  } else if (poll.closed && data.owner) panel.append(create('p','Добавьте продолжение сезона, чтобы связать его с итогом.'));
  panel.append(status);
 }
 function load(panel) {
  display(panel).catch(error => {panel.textContent = error.message;});
 }
 const panels = document.querySelectorAll('[data-episode-poll]');
 if ('IntersectionObserver' in window) {
  const observer = new IntersectionObserver(entries => {
   for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    observer.unobserve(entry.target);
    load(entry.target);
   }
  }, {rootMargin:'240px'});
  for (const panel of panels) observer.observe(panel);
 } else {
  panels.forEach(load);
 }
})();
