<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{
  currentPage: number;
  pageSize: number;
  total: number;
}>();

const emit = defineEmits<{
  "update:currentPage": [page: number];
}>();

// 计算总页数
const totalPages = computed(() => Math.ceil(props.total / props.pageSize));

// 计算显示的页码范围
const pageRange = computed(() => {
  const current = props.currentPage;
  const total = totalPages.value;
  const range: number[] = [];

  if (total <= 7) {
    // 总页数小于等于 7，显示所有页码
    for (let i = 1; i <= total; i++) {
      range.push(i);
    }
  } else {
    // 总页数大于 7，智能显示页码
    if (current <= 3) {
      // 当前页靠前
      range.push(1, 2, 3, 4, -1, total);
    } else if (current >= total - 2) {
      // 当前页靠后
      range.push(1, -1, total - 3, total - 2, total - 1, total);
    } else {
      // 当前页在中间
      range.push(1, -1, current - 1, current, current + 1, -1, total);
    }
  }

  return range;
});

// 计算显示的数据范围
const displayRange = computed(() => {
  const start = (props.currentPage - 1) * props.pageSize + 1;
  const end = Math.min(props.currentPage * props.pageSize, props.total);
  return { start, end };
});

function goToPage(page: number) {
  if (page < 1 || page > totalPages.value || page === props.currentPage) {
    return;
  }
  emit("update:currentPage", page);
}

function prevPage() {
  goToPage(props.currentPage - 1);
}

function nextPage() {
  goToPage(props.currentPage + 1);
}
</script>

<template>
  <div class="app-pagination">
    <div class="pagination-info">
      显示 <strong>{{ displayRange.start }}</strong> - <strong>{{ displayRange.end }}</strong> 条，共 <strong>{{ total }}</strong> 条
    </div>
    <div class="pagination-controls">
      <button
        type="button"
        class="pagination-btn"
        :disabled="currentPage === 1"
        @click="prevPage"
      >
        上一页
      </button>
      <template v-for="(page, index) in pageRange" :key="index">
        <button
          v-if="page === -1"
          type="button"
          class="pagination-ellipsis"
          disabled
        >
          ...
        </button>
        <button
          v-else
          type="button"
          class="pagination-btn"
          :class="{ active: page === currentPage }"
          @click="goToPage(page)"
        >
          {{ page }}
        </button>
      </template>
      <button
        type="button"
        class="pagination-btn"
        :disabled="currentPage === totalPages"
        @click="nextPage"
      >
        下一页
      </button>
    </div>
  </div>
</template>

<style scoped>
.app-pagination {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 0;
  gap: 24px;
  flex-wrap: wrap;
}

.pagination-info {
  font-size: 14px;
  color: #64748b;
  line-height: 1.6;
}

.pagination-info strong {
  color: #0f9f9a;
  font-weight: 600;
}

.pagination-controls {
  display: flex;
  align-items: center;
  gap: 6px;
}

.pagination-btn,
.pagination-ellipsis {
  min-width: 36px;
  height: 36px;
  padding: 0 10px;
  border: 1px solid #e2e8f0;
  background: #ffffff;
  color: #334155;
  font-size: 14px;
  font-weight: 500;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s ease;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.pagination-btn:hover:not(:disabled):not(.active) {
  background: #f8fafb;
  border-color: #cbd5e1;
}

.pagination-btn.active {
  background: #0f9f9a;
  border-color: #0f9f9a;
  color: #ffffff;
  font-weight: 600;
}

.pagination-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
  background: #f8fafb;
}

.pagination-ellipsis {
  border-color: transparent;
  background: transparent;
  cursor: default;
  color: #94a3b8;
}

@media (max-width: 640px) {
  .app-pagination {
    flex-direction: column;
    align-items: stretch;
    gap: 16px;
  }

  .pagination-info {
    text-align: center;
  }

  .pagination-controls {
    justify-content: center;
    flex-wrap: wrap;
  }
}
</style>
