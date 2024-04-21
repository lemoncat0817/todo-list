<template>
  <div class="app">
    <div class="container">
      <div class="headerMain">
        <todoHeader @addTask="handleNewTask" />
        <todoMain :list="list" :filteredTodos="filteredTodos" @completed="handleCompleted" @delTask="handleTask"
          @changeAll="handleAllTask" @saveEdit="handleEdit" @startEdit="startEditing" />
      </div>
      <div class="footer">
        <todoFooter :list="list" :filter="filter" :active="active" @changeActive="handleActive"
          @clearCompleted="clearList" />
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, watch, computed } from "vue";
import todoHeader from './components/todoHeader.vue'
import todoMain from './components/todoMain.vue'
import todoFooter from './components/todoFooter.vue'

//從本地抓取存儲的資料
const list = ref(JSON.parse(localStorage.getItem('todolist')) || [])

const filter = ref(['全部', '未完成', '已完成'])

const active = ref('全部')

//刪除線功能
const handleCompleted = (id) => {
  if (!Array.isArray(list.value)) {
    // 如果 props.list 不是陣列，將其轉換為陣列
    list.value = [list.value];
}
  const todo = list.value.find(item => item.id === id)
  todo.isCompleted = !todo.isCompleted
}
//刪除todo功能
const handleTask = (id) => {
  if (!Array.isArray(list.value)) {
    // 如果 props.list 不是陣列，將其轉換為陣列
    list.value = [list.value];
}
  list.value = list.value.filter(item => item.id !== id)
}
//新增todo功能
const handleNewTask = (task) => {
  if (task !== '') {
    list.value.push({
      id: Date.now(),
      taskname: task,
      isCompleted: false,
      isEditing: false,
    })
  }
}
//全 選 or 取消 todo功能
const handleAllTask = (val) => {
  if (!Array.isArray(list.value)) {
    // 如果 props.list 不是陣列，將其轉換為陣列
    list.value = [list.value];
}
  list.value.forEach(item => item.isCompleted = val)
}
//切換選擇的狀態選單
const handleActive = (nowActive) => {
  active.value = nowActive
}
//篩選狀態的todo
const filteredTodos = computed({
  get() {
    if (!Array.isArray(list.value)) {
    // 如果 props.list 不是陣列，將其轉換為陣列
    list.value = [list.value];
}
    if (active.value === '已完成') {
      return list.value.filter(todo => todo.isCompleted);
    } else if (active.value === '未完成') {
      return list.value.filter(todo => !todo.isCompleted);
    } else {
      return list.value
    }
  }
})
//清除已完成的todo
const clearList = () => {
  if (!Array.isArray(list.value)) {
    // 如果 props.list 不是陣列，將其轉換為陣列
    list.value = [list.value];
}
  list.value = list.value.filter(item => !item.isCompleted)
}
//編輯todo
const startEditing = (id) => {
  if (!Array.isArray(list.value)) {
    // 如果 props.list 不是陣列，將其轉換為陣列
    list.value = [list.value];
}
  const editList = list.value.find(item => item.id === id)
  editList.isEditing = !editList.isEditing
}
//完成編輯todo
const handleEdit = (id) => {
  if (!Array.isArray(list.value)) {
    // 如果 props.list 不是陣列，將其轉換為陣列
    list.value = [list.value];
}
  const editList = list.value.find(item => item.id === id)
  editList.isEditing = false
}


//存儲到本地
watch(list, () => {
  localStorage.setItem('todolist', JSON.stringify(list.value))
}, { deep: true })
</script>

<style scoped>
.app {
  width: 100%;
  height: 943px;
  display: flex;
  justify-content: center;
  align-items: center;
  background-image: url('./assets/bg.png');
  background-repeat: no-repeat;
  background-size: cover;
  background-color: rgba(169, 198, 235, 0.3);
  background-blend-mode: multiply;

}

.container {
  width: 500px;
  height: 500px;
  background-color: #52acb86c;
  border-radius: 50px;
  box-shadow: 0px 0px 10px black;
  display: flex;
  align-items: center;
  flex-direction: column;
  justify-content: space-between;
  overflow: auto;
}
</style>
