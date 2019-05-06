import * as cheerio from 'cheerio';
import * as path from 'path';
import * as fs from 'fs';
import { JSDOM } from 'jsdom';
// @ts-ignore
import youdao from 'youdao-node';
import { Converter } from 'showdown';
import { URL } from 'url';
import { default as axios } from 'axios';

const resolve = (_path: string) => new URL(_path, prefix).toString();

const prefix = 'https://www.jianshu.com/';

type Config = {
  uid: string;
  articlePage: number;
  dist: string;
  translation: {
    "appKey": string,
    "appSecret": string
  }
}

type Article = { title: string; content: string; titleTranslation?: string }

export async function run(config: Config) {
  const articleList = await fetchJianShuArticleUrl(config);
  const articles = await fetchArticleContent(config, articleList);
  redirectMarkdown(config, articles);
}

async function redirectMarkdown(config: Config, articles: Article[]) {
  if (config.translation.appKey !== '') {
    await translateLanguage(config, articles);
  }
  for (let article of articles) {
    let mdArticle = new Converter().makeMarkdown(article.content, new JSDOM(article.content).window.document)
    // 主要是为了生成 hexo 的 post 文件格式
    mdArticle = `---\ntitle: ${article.title}\n---\n\n${mdArticle}`;
    fs.writeFileSync(path.resolve(config.dist, `${article.titleTranslation || article.title}`), mdArticle);
  }
}

async function fetchArticleContent(config: Config, urlList: string[]) {
  const articles: {
    title: string;
    content: string;
  }[] = [];
  for (let url of urlList) {
    const result = await axios.get(resolve(url)).catch((e) => { throw e });
    const $article = cheerio.load(result.data);
    const title = $article('title').text().split(' - 简书').join('');
    console.log(`has download article ${title}`);
    $article('div.image-package')
      .each((_, elem) => {
        let imageWrapper = $article(elem);
        let imageSrc = imageWrapper.find('.image-view img').attr('data-original-src')
        let caption = imageWrapper.find('.image-caption').text();
        imageWrapper.replaceWith(`<img src="${imageSrc}" alt="${caption}" >`)
      })

    articles.push({
      title,
      content: $article('.post .article .show-content .show-content-free').html() || ''
    })
  }

  return articles;
}

async function fetchJianShuArticleUrl(config: Config) {
  const urlList: string[] = [];
  let page = 1;
  while (true) {
    const result = await axios.get(resolve(`/u/${config.uid}?order_by=shared_at&page=${page}`))
      .catch(e => { throw e })
    if (page > config.articlePage) {
      console.log(`finish fetching article List, total page:${config.articlePage}, articleCount: ${urlList.length}`);
      break;
    }
    console.log(`fetching page ${page}...`)
    cheerio
      .load(result.data)('li > .content > a')
      .each((i, elem) => {
        urlList.push(elem.attribs.href)
      });
    page++;
  }

  return urlList;
}

// https://cloud.google.com/translate/docs/quickstart-client-libraries#client-libraries-install-nodejs
async function translateLanguage(config: Config, articles: Article[]) {
  console.log('开始翻译标题...')
  youdao.config({
    appKey: config.translation!.appKey,
    appSecret: config.translation!.appSecret
  });
  for (let articleIndex in articles) {
    let article = articles[articleIndex];
    const data = await youdao.translate({
      content: article.title,
      from: 'zh-CHS',
      to: 'en'
    });
    console.log(`${articleIndex}/${articles.length} source: ${article.title}, to: ${data.translation}`)
    console.log(typeof data.translation);
    article.titleTranslation = String(data.translation)
      .split(' ')
      .map(
        w => { 
          let s = w.split(''); 
          s[0] = s[0].toUpperCase(); 
          return s.join('') 
      })
      .join('-')
  }
  console.log('全部翻译完成')
  return;
}
