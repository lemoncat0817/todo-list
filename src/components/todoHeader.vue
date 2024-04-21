<template>
  <div class="headerContainer">
    <h1>Todo List</h1>
    <div class="content">
      <div class="empty"></div>
      <div class="Addbar">
        <input maxlength="10" type="text" placeholder="請輸入代辦事項..." v-model.trim="taskname" @keyup.enter="handleTask" />
        <button class="addBtn" @click="handleTask">添加</button>
      </div>
    </div>
  </div>



</template>

<script setup>
import { ref } from "vue"


const emit = defineEmits(['addTask'])

const taskname = ref('')

//回傳新增的task給根組件並將輸入task的input給清空
const handleTask = () => {
  emit('addTask', taskname.value)
  taskname.value = ''
}

</script>

<style scoped>
.headerContainer {
  height: 120px;
}

.headerContainer h1 {
  text-align: center;
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


.Addbar {
  height: 40px;
}

.Addbar input {
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

.Addbar .addBtn {
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

.Addbar .addBtn:hover {
  background-color: #6666661a;
}

.Addbar .addBtn:active {
  background-color: #66666698;
}
</style>
