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

type Article = {
  title: string;
  content: string;
  images: {
    caption: string;
    content: Buffer;
  }[];
  titleTranslation?: string;
}

export async function run(config: Config) {
  try {
    const articleList = await fetchJianShuArticleUrl(config);
    const articles = await fetchArticleContent(config, articleList);
    redirectMarkdown(config, articles);
  } catch (e) {
    console.error(e);
  }

}

async function redirectMarkdown(config: Config, articles: Article[]) {
  if (config.translation.appKey !== '') {
    await translateLanguage(config, articles);
  }
  console.log('开始写入文件');
  for (let article of articles) {
    console.log('开始生成 ' + article.title);
    let mdArticle = new Converter().makeMarkdown(article.content, new JSDOM(article.content).window.document)
    // 主要是为了生成 hexo 的 post 文件格式
    mdArticle = `---\ntitle: ${article.title}\n---\n\n${mdArticle}`;
    let dist = path.resolve(config.dist, article.titleTranslation!);
    await mkdir(dist);
    fs.writeFileSync(path.resolve(dist, `${article.titleTranslation || article.title}.md`), mdArticle);
    console.log('has generate md: ' + article.title);
    for (let image of article.images) {
      fs.writeFileSync(path.resolve(dist, image.caption), image.content);
      console.log('has generate image: ' + image.caption);
    }
  }
}

async function fetchArticleContent(config: Config, urlList: string[]): Promise<Article[]> {
  const articles: {
    title: string;
    content: string;
    images: {
      caption: string;
      content: Buffer;
    }[]
  }[] = [];
  for (let url of urlList) {
    const result = await axios.get(resolve(url)).catch((e) => { throw e });
    const $article = cheerio.load(result.data);
    const title = $article('title').text().split(' - 简书').join('');
    console.log(`has download article ${title}`);
    let imageUrls: { url: string; caption: string }[] = [];
    let images: { caption: string; content: Buffer }[] = [];
    const salts: string[] = [];
    $article('div.image-package')
      .each(async (_, elem) => {
        let imageWrapper = $article(elem);
        let imageSrc = imageWrapper.find('.image-view img').attr('data-original-src')
        // 防止图片重名
        let salt = getSalt(5, salts);
        salts.push(salt);
        let caption = salt + '$' + imageWrapper.find('.image-caption').text();
        imageWrapper.replaceWith(`<img src="./${caption}" alt="${caption}" >`)
        imageUrls.push({
          caption,
          url: 'https:' + imageSrc
        });
      })
    for (let imageInfo of imageUrls) {
      let image = await fetchArticleImages(imageInfo.url);
      images.push({
        caption: imageInfo.caption,
        content: image
      });
      console.log('has download image ' + imageInfo.caption + 'in ' + title);
    }
    articles.push({
      title,
      content: $article('.post .article .show-content .show-content-free').html() || '',
      images
    })
  }

  return articles;
}

async function fetchArticleImages(url: string): Promise<Buffer> {
  let res = await axios.get(url, {
    responseType: 'arraybuffer'
  })
  return Buffer.alloc(res.data.length, res.data, 'binary');
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

async function mkdir(path: string): Promise<void> {
  try {
    console.log('生成文件夹: ' + path);
    return new Promise((resolve, reject) => {
      fs.mkdir(path, { recursive: true }, (err) => {
        if (err) {
          throw err;
        } else {
          console.log('success');
          resolve();
        }
      })
    });
  } catch (e) {
    console.log('use exist dir: ' + path);
    return Promise.resolve();
  }
}

function getSalt(len: 5, exclude: string[]): string {
  let range = 'abcdefghigklmnopqrstuvwxyz';
  let ret: string = '';
  for (let i = 0; i < len; i++) {
    let index = Math.floor(Math.random() * 26);
    ret += range[index];
  }
  if(exclude.includes(ret)) return getSalt(len, exclude);
  else return ret;
}
