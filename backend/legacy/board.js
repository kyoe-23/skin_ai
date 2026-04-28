const express = require('express');
const { body, validationResult } = require('express-validator');
const { authenticateToken, optionalAuth } = require('../middleware/auth');
const { createPostLimiter } = require('../middleware/rateLimiter');

const router = express.Router();

// 임시 게시글 저장소 (나중에 데이터베이스로 교체)
let posts = [];
let postIdCounter = 1;

// 댓글 저장소
let comments = {};

// 좋아요 저장소 (postId -> Set of userIds)
let likes = {};

// 게시글 목록 조회 및 검색 (GET /api/board/free/posts?search=keyword)
router.get('/free/posts', (req, res) => {
  try {
    const searchKeyword = req.query.search;
    let filteredPosts = posts;

    // 검색어가 있으면 필터링
    if (searchKeyword) {
      const keyword = searchKeyword.toLowerCase();
      filteredPosts = posts.filter(post =>
        post.title.toLowerCase().includes(keyword) ||
        post.content.toLowerCase().includes(keyword) ||
        post.authorName.toLowerCase().includes(keyword)
      );
    }

    // 최신순으로 정렬
    const sortedPosts = [...filteredPosts].sort((a, b) =>
      new Date(b.createdAt) - new Date(a.createdAt)
    );

    // 각 게시글의 댓글 수와 좋아요 수 추가
    const postsWithCounts = sortedPosts.map(post => ({
      ...post,
      commentCount: comments[post.id] ? comments[post.id].length : 0,
      likeCount: likes[post.id] ? likes[post.id].size : 0
    }));

    res.json({
      success: true,
      data: postsWithCounts,
      total: postsWithCounts.length
    });
  } catch (error) {
    console.error('게시글 목록 조회 에러:', error);
    res.status(500).json({
      success: false,
      message: '서버 오류가 발생했습니다'
    });
  }
});

// 게시글 작성 (POST /api/board/free/posts)
router.post('/free/posts', authenticateToken, createPostLimiter, [
  body('title').notEmpty().withMessage('제목을 입력해주세요'),
  body('content').notEmpty().withMessage('내용을 입력해주세요')
], (req, res) => {
  try {
    // 입력값 검증
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: '입력값 오류',
        errors: errors.array()
      });
    }

    const { category, title, content } = req.body;

    // JWT에서 사용자 정보 가져오기
    const authorId = req.user.userId;

    // users 배열에서 사용자 이름 가져오기 (auth.js에서 가져와야 함)
    const authModule = require('./auth');
    const user = authModule.users.find(u => u.id === authorId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: '사용자를 찾을 수 없습니다'
      });
    }

    // 새 게시글 생성
    const newPost = {
      id: postIdCounter++,
      category: category || 'free', // 카테고리 기본값: 자유게시판
      title,
      content,
      authorId,
      authorName: user.name,
      views: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    posts.push(newPost);

    res.status(201).json({
      success: true,
      message: '게시글이 작성되었습니다',
      data: newPost
    });
  } catch (error) {
    console.error('게시글 작성 에러:', error);
    res.status(500).json({
      success: false,
      message: '서버 오류가 발생했습니다'
    });
  }
});

// 게시글 상세 조회 (GET /api/board/free/posts/:id)
router.get('/free/posts/:id', (req, res) => {
  try {
    const postId = parseInt(req.params.id);
    const post = posts.find(p => p.id === postId);

    if (!post) {
      return res.status(404).json({
        success: false,
        message: '게시글을 찾을 수 없습니다'
      });
    }

    // 조회수 증가
    post.views += 1;

    // 댓글과 좋아요 정보 추가
    const postWithDetails = {
      ...post,
      comments: comments[postId] || [],
      likeCount: likes[postId] ? likes[postId].size : 0,
      commentCount: comments[postId] ? comments[postId].length : 0
    };

    res.json({
      success: true,
      data: postWithDetails
    });
  } catch (error) {
    console.error('게시글 조회 에러:', error);
    res.status(500).json({
      success: false,
      message: '서버 오류가 발생했습니다'
    });
  }
});

// 게시글 수정 (PUT /api/board/free/posts/:id)
router.put('/free/posts/:id', authenticateToken, [
  body('title').notEmpty().withMessage('제목을 입력해주세요'),
  body('content').notEmpty().withMessage('내용을 입력해주세요')
], (req, res) => {
  try {
    // 입력값 검증
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: '입력값 오류',
        errors: errors.array()
      });
    }

    const postId = parseInt(req.params.id);
    const { category, title, content } = req.body;
    const authorId = req.user.userId;
    const postIndex = posts.findIndex(p => p.id === postId);

    if (postIndex === -1) {
      return res.status(404).json({
        success: false,
        message: '게시글을 찾을 수 없습니다'
      });
    }

    // 작성자 확인
    if (posts[postIndex].authorId !== authorId) {
      return res.status(403).json({
        success: false,
        message: '게시글을 수정할 권한이 없습니다'
      });
    }

    // 게시글 수정
    posts[postIndex] = {
      ...posts[postIndex],
      category: category || posts[postIndex].category || 'free',
      title,
      content,
      updatedAt: new Date().toISOString()
    };

    res.json({
      success: true,
      message: '게시글이 수정되었습니다',
      data: posts[postIndex]
    });
  } catch (error) {
    console.error('게시글 수정 에러:', error);
    res.status(500).json({
      success: false,
      message: '서버 오류가 발생했습니다'
    });
  }
});

// 게시글 삭제 (DELETE /api/board/free/posts/:id)
router.delete('/free/posts/:id', authenticateToken, (req, res) => {
  try {
    const postId = parseInt(req.params.id);
    const authorId = req.user.userId;
    const postIndex = posts.findIndex(p => p.id === postId);

    if (postIndex === -1) {
      return res.status(404).json({
        success: false,
        message: '게시글을 찾을 수 없습니다'
      });
    }

    // 작성자 확인
    if (posts[postIndex].authorId !== authorId) {
      return res.status(403).json({
        success: false,
        message: '게시글을 삭제할 권한이 없습니다'
      });
    }

    // 게시글과 관련 데이터 삭제
    const deletedPost = posts.splice(postIndex, 1)[0];
    delete comments[postId];
    delete likes[postId];

    res.json({
      success: true,
      message: '게시글이 삭제되었습니다',
      data: deletedPost
    });
  } catch (error) {
    console.error('게시글 삭제 에러:', error);
    res.status(500).json({
      success: false,
      message: '서버 오류가 발생했습니다'
    });
  }
});

// 게시글 좋아요 (POST /api/board/free/posts/:id/like)
router.post('/free/posts/:id/like', authenticateToken, (req, res) => {
  try {
    const postId = parseInt(req.params.id);
    const userId = req.user.userId;
    const post = posts.find(p => p.id === postId);

    if (!post) {
      return res.status(404).json({
        success: false,
        message: '게시글을 찾을 수 없습니다'
      });
    }

    // 좋아요 Set 초기화
    if (!likes[postId]) {
      likes[postId] = new Set();
    }

    // 이미 좋아요한 경우
    if (likes[postId].has(userId)) {
      return res.status(400).json({
        success: false,
        message: '이미 좋아요를 눌렀습니다'
      });
    }

    // 좋아요 추가
    likes[postId].add(userId);

    res.json({
      success: true,
      message: '좋아요를 눌렀습니다',
      data: {
        postId,
        likeCount: likes[postId].size
      }
    });
  } catch (error) {
    console.error('좋아요 에러:', error);
    res.status(500).json({
      success: false,
      message: '서버 오류가 발생했습니다'
    });
  }
});

// 댓글 작성 (POST /api/board/free/posts/:id/comments)
router.post('/free/posts/:id/comments', authenticateToken, [
  body('content').notEmpty().withMessage('댓글 내용을 입력해주세요')
], (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: '입력값 오류',
        errors: errors.array()
      });
    }

    const postId = parseInt(req.params.id);
    const { content } = req.body;
    const authorId = req.user.userId;

    // 사용자 정보 가져오기
    const authModule = require('./auth');
    const user = authModule.users.find(u => u.id === authorId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: '사용자를 찾을 수 없습니다'
      });
    }

    const post = posts.find(p => p.id === postId);

    if (!post) {
      return res.status(404).json({
        success: false,
        message: '게시글을 찾을 수 없습니다'
      });
    }

    // 댓글 배열 초기화
    if (!comments[postId]) {
      comments[postId] = [];
    }

    // 새 댓글 생성
    const newComment = {
      id: comments[postId].length + 1,
      postId,
      content,
      authorId,
      authorName: user.name,
      createdAt: new Date().toISOString()
    };

    comments[postId].push(newComment);

    res.status(201).json({
      success: true,
      message: '댓글이 작성되었습니다',
      data: newComment
    });
  } catch (error) {
    console.error('댓글 작성 에러:', error);
    res.status(500).json({
      success: false,
      message: '서버 오류가 발생했습니다'
    });
  }
});

// 댓글 삭제 (DELETE /api/board/free/posts/:id/comments)
router.delete('/free/posts/:postId/comments/:commentId', authenticateToken, (req, res) => {
  try {
    const postId = parseInt(req.params.postId);
    const commentId = parseInt(req.params.commentId);
    const authorId = req.user.userId;

    if (!comments[postId]) {
      return res.status(404).json({
        success: false,
        message: '댓글을 찾을 수 없습니다'
      });
    }

    const commentIndex = comments[postId].findIndex(c => c.id === commentId);

    if (commentIndex === -1) {
      return res.status(404).json({
        success: false,
        message: '댓글을 찾을 수 없습니다'
      });
    }

    // 작성자 확인
    if (comments[postId][commentIndex].authorId !== authorId) {
      return res.status(403).json({
        success: false,
        message: '댓글을 삭제할 권한이 없습니다'
      });
    }

    // 댓글 삭제
    const deletedComment = comments[postId].splice(commentIndex, 1)[0];

    res.json({
      success: true,
      message: '댓글이 삭제되었습니다',
      data: deletedComment
    });
  } catch (error) {
    console.error('댓글 삭제 에러:', error);
    res.status(500).json({
      success: false,
      message: '서버 오류가 발생했습니다'
    });
  }
});

// 다른 모듈에서 사용할 수 있도록 데이터 export
module.exports = router;
module.exports.posts = posts;
module.exports.comments = comments;
