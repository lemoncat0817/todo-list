<template>
  <div class="headerContainer">
    <div class="headerTop">
      <h1 class="headerTitle">Todo List</h1>
      <button v-if="!model" class="toggleBtn" @click="toggle">切換成搜尋模式</button>
      <button v-else class="toggleBtn" @click="toggle">切換成添加模式</button>
    </div>
    <div class="content">
      <div class="empty"></div>
      <div v-if="!model" class="bar">
        <input maxlength="10" type="text" placeholder="請輸入代辦事項..." v-model.trim="taskname" @keyup.enter="handleTask" />
        <button class="Btn" @click="handleTask">添加</button>
      </div>
      <div v-else class="bar">
        <input maxlength="10" type="text" placeholder="請輸入搜尋關鍵字..." v-model.trim="tasknameKeyword"
          @keyup.enter="searchTask" />
        <button class="Btn" @click="searchTask">🔎</button>
      </div>
    </div>
  </div>



</template>

<script setup>
import { ref, watch, onMounted } from "vue"


const emit = defineEmits(['addTask', 'searchTask', 'toggle'])

const taskname = ref('')
const tasknameKeyword = ref('')
const model = ref(false)

//回傳新增的task給根組件並將輸入task的input給清空
const handleTask = () => {
  emit('addTask', taskname.value)
  taskname.value = ''
}

const toggle = () => {
  // false = 搜尋模式
  // true = 新增模式
  emit('toggle', model.value, tasknameKeyword.value)
  model.value = !model.value
  tasknameKeyword.value = ''
  taskname.value = ''
}



watch(() => tasknameKeyword.value, () => {
  emit('searchTask', tasknameKeyword.value)
})

</script>

<style scoped>
.headerContainer {
  height: 120px;
}

.headerTop {
  display: flex;
  justify-content: center;
  align-items: center;
  text-align: center;
  font-size: 30px;
  margin: 20px 0px;
}


.toggleBtn {
  margin-right: -130px;
  margin-left: 30px;
  height: 40px;
  width: 120px;
  border: none;
  border-radius: 30px;
  background-color: #6666661a;
  cursor: pointer;
  font-weight: bold;
}

.toggleBtn:hover {
  background-color: #66666698;
}

.toggleBtn:active {
  background-color: #66666698;
}



.content {
  display: flex;
  flex-direction: row;
  width: 400px;
  height: 40px;
}

.empty {
  width: 50px;
  height: 40px;
}


.bar {
  height: 40px;
}

.bar input {
  border: none;
  padding: 0;
  height: 40px;
  width: 300px;
  font-size: 15px;
  margin-bottom: 20px;
  text-align: center;
  border-radius: 30px;
  border-top-right-radius: 0px;
  border-bottom-right-radius: 0px;
  font-weight: bold;
}

.bar .Btn {
  width: 50px;
  height: 40px;
  padding: 0px;
  border: none;
  border-radius: 30px;
  border-top-left-radius: 0px;
  border-bottom-left-radius: 0px;
  cursor: pointer;
  font-weight: bold;
}

.bar .Btn:hover {
  background-color: #6666661a;
}

.bar .Btn:active {
  background-color: #66666698;
}
</style>
