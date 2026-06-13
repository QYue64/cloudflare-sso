<template>
  <div class="form-actions">
    <el-button v-if="showCancel" @click="$emit('cancel')">取消</el-button>
    <el-button type="primary" native-type="submit" :loading="busy">{{ submitText }}</el-button>
  </div>
</template>

<script setup lang="ts">
withDefaults(
  defineProps<{
    busy?: boolean;
    submitText?: string;
    showCancel?: boolean;
  }>(),
  { busy: false, submitText: "保存", showCancel: true }
);

defineEmits<{
  cancel: [];
}>();
</script>
