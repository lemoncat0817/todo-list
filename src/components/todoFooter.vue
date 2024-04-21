<template>
  <div class="footerContent">
    <div class="footerText">
      <span  :class="{display: active === '已完成' && '全部'}">代辦事項數量: {{ leftCount }}</span>
      <span :class="{display: active === '未完成' && '全部'}">已完成事項數量: {{ completedCount }}</span>
    </div>
    <div class="footerContentli">
      <li v-for="item in filter" :key="item"><a :class="{ selected: item === active }"
          @click="emit('changeActive', item)">{{ item }}</a></li>
    </div>
    <button class="clearBtn" @click="emit('clearCompleted')">清除已完成</button>
  </div>

</template>

<script setup>
import { computed } from "vue";
const props = defineProps(['list', 'filter', 'active'])
const emit = defineEmits(['changeActive', 'clearCompleted'])

if (!Array.isArray(props.list)) {
    // 如果 props.list 不是陣列，將其轉換為陣列
    props.list = [props.list];
}

//篩選出代辦事情的數量
const leftCount = computed(() => props.list.filter(item => !item.isCompleted).length)
//篩選出完成事情的數量
const completedCount = computed(() => props.list.filter(item => item.isCompleted).length)



</script>

<style scoped>
.footerContent {
  width: 400px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  height: 50px;
}

.footerContentli {
  display: flex;
}

.footerContent li {
  list-style: none;
  margin: 3px;
}

.footerText{
  display: flex;
  flex-direction: column;
}

.clearBtn {
  border: none;
  cursor: pointer;
  border-radius: 30px;
  font-size: 15px;
  background: #a5070759;
}

.clearBtn:hover {
  background-color: #44434394;
}

.clearBtn:active {
  background-color: #333131be;
}

.footerContentli a {
  cursor: pointer;
}

.selected {
  border-style: solid;
  border-color: #6666663f;
  border-radius: 30px;
  padding: 3px;
  background-color: rgba(255, 228, 196, 0.541);
}

.display{
  display: none;
}

</style>
