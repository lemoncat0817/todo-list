<template>
  <div class="app w-full min-h-[100vh] bg-gradient-to-r from-purple-500 to-pink-500 flex justify-center items-center">
    <div class="w-[700px] sm:h-[700px] border-white border-solid border-2 rounded-lg bg-red-500 h-[750px]">
      <todoHeader />
      <RouterView />
      <todoFooter />
    </div>
  </div>
</template>

<script setup lang="ts">
import { RouterView } from 'vue-router'
import todoHeader from './components/todoHeader.vue'
import todoFooter from './components/todoFooter.vue'
</script>

<style scoped></style>
