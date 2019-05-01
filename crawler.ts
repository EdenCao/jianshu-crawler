import * as cheerio from 'cheerio';
import * as path from 'path';
import * as fs from 'fs';
import { Converter } from 'showdown';
import { JSDOM } from 'jsdom';
import { URL } from 'url';
import { default as axios } from 'axios';

const resolve = (_path: string) => new URL(_path, prefix).toString();

const prefix = 'https://www.jianshu.com/';



type Config = {
  uid: string;
  articlePage: number;
  dist: string;
}

export async function run(config: Config) {
  const articleList = await fetchJianShuArticleUrl(config);
  const articles = await fetchArticleContent(config, articleList);
  redirectMarkdown(config, articles);
}

function redirectMarkdown(config: Config, articles: {title: string; content: string}[]) { 
  for (let article of articles) {
    let mdArticle = new Converter().makeMarkdown(article.content, new JSDOM(article.content).window.document)
    fs.writeFileSync(path.resolve(config.dist, article.title + '.md'), mdArticle);
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
    const title = $article('title').text()
    console.log(`has download article ${title}`);

    $article('.post .article .show-content .show-content-free')
      .each(function (i, elem) {
        articles.push({
          title,
          content: '<h1>' + title + '</h1>' + $article(elem).html()
        })
      });
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

