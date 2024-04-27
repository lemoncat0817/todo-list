<template>
  <div class="content">
    <input type="checkbox" class="allBtn" v-show="filteredTodos.length !== 0" @click="changeAll" v-model="isAll">
    <li v-for="item in filteredTodos" :key="item.id">
      <input type="checkbox" :checked="item.isCompleted" @click="emit('completed', item.id)" />
      <span class="taskName" :class="{ completed: item.isCompleted }">
        {{ item.taskname }}
      </span>
      <input maxlength="20" class="editInput" v-if="item.isEditing" v-model="item.taskname"
        @blur="emit('saveEdit', item.id)" @keyup.enter="emit('saveEdit', item.id)">
      <button class="delBtn" @click="emit('delTask', item.id)">刪除</button>
      <button class="editBtn" @click="emit('startEdit', item.id)">編輯</button>
    </li>
  </div>
</template>

<script setup>
import { computed } from "vue"


const props = defineProps(['list', 'filteredTodos'])
const emit = defineEmits(['completed', 'delTask', 'changeAll', 'saveEdit', 'startEdit'])




//定義isAll需要達成全數勾選後回傳true，並且回傳isAll的true or false
const isAll = computed({
  get() {
    if (!Array.isArray(props.list)) {
      // 如果 props.list 不是陣列，將其轉換為陣列
      props.list = [props.list];
    }
    return props.list.every(item => item.isCompleted)
  },
  set(val) {
    emit('changeAll', val)
  },
})

</script>

<style scoped>
* {
  padding: 0;
  margin: 0;
}


.content {
  width: 80%;
  display: flex;
  justify-content: center;
  flex-direction: column;
  position: relative;
}


.content .allBtn {
  position: absolute;
  margin-top: -60px;
  top: 0;
  left: 0;
  width: 50px;
  height: 40px;
  border-radius: 30px;
  border: none;
  border-top-right-radius: 0px;
  border-bottom-right-radius: 0px;
  cursor: pointer;
}



.content li {
  font-size: 20px;
  width: 400px;
  height: 30px;
  list-style: none;
  margin: 5px 0px;
  background-color: #39474e21;
  border-radius: 30px;
  text-align: center;
  font-weight: bold;
  overflow: auto;
}

.content li .taskName {
  line-height: 30px;
}

.content li input {
  float: left;
  line-height: 30px;
  height: 30px;
  width: 20px;
  margin-left: 5px;
  cursor: pointer;
}

.content .editInput {
  width: 70px;
}

.content li .editBtn {
  float: right;
  line-height: 30px;
  height: 30px;
  width: 45px;
  border: none;
  border-radius: 10px;
  cursor: pointer;
  border-top-right-radius: 0px;
  border-bottom-right-radius: 0px;
  background-color: #c4ee07;
}

.content li .editBtn:hover {
  background-color: #c4ee0752;
  ;
}

.content li .editBtn:active {
  background-color: #c4ee07c4;
}

.content li .delBtn {
  float: right;
  line-height: 30px;
  height: 30px;
  width: 45px;
  border: none;
  border-radius: 10px;
  cursor: pointer;
  border-top-left-radius: 0px;
  border-bottom-left-radius: 0px;
  background-color: rgb(255, 0, 0);
}


.content li .delBtn:hover {
  background-color: rgba(255, 0, 0, 0.329);
}

.content li .delBtn:active {
  background-color: rgba(255, 0, 0, 0.671);
}

.completed {
  text-decoration: line-through;
}
</style>
