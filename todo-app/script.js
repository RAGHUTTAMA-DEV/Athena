const input = document.getElementById('todo-input');
const addBtn = document.getElementById('add-btn');
const todoList = document.getElementById('todo-list');
const themeToggle = document.getElementById('theme-toggle');

addBtn.addEventListener('click', () => {
    const text = input.value.trim();
    if (text === '') return;

    const li = document.createElement('li');
    li.innerHTML = `
        <span class="task-text">${text}</span>
        <button class="delete-btn">Delete</button>
    `;

    li.addEventListener('click', (e) => {
        if (e.target.className !== 'delete-btn') {
            li.classList.toggle('completed');
        }
    });

    li.querySelector('.delete-btn').addEventListener('click', () => {
        li.remove();
    });

    todoList.appendChild(li);
    input.value = '';
});

themeToggle.addEventListener('click', () => {
    document.body.classList.toggle('dark-mode');
});
